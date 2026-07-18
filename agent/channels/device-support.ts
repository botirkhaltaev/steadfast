import { defineChannel, GET, POST } from "eve/channels";
import type { SessionAuthContext } from "eve/context";
import wassist from "./wassist";
import {
  buildDeviceSupportOutcomeMessage,
  GeminiRateLimitError,
  markLinkOutcome,
  markLinkStarted,
  mintGeminiEphemeralToken,
  resetLinkToSent,
  verifyLinkToken,
  type DeviceSupportOutcome,
} from "#lib/device-support";
import { renderDeviceSupportPage } from "#lib/device-support-page";
import { waitForTurnSettlement } from "#lib/session-wait";

type ChannelState = Record<string, never>;

const OUTCOMES = new Set<DeviceSupportOutcome>([
  "completed",
  "abandoned",
  "escalate",
]);

function jsonError(error: string, status: number, message?: string) {
  return Response.json(
    { error, ...(message ? { message } : {}) },
    { status },
  );
}

export default defineChannel<ChannelState>({
  cors: false,
  state: {},

  routes: [
    /**
     * Patient-facing Tasso+ Gemini Live helper page.
     * Under `/eve/v1/...` so withEve proxies it (same pattern as wassist/clinician).
     * Query: ?t=<signed link token from Scout>
     */
    GET("/eve/v1/device-support", async () => {
      return new Response(renderDeviceSupportPage(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }),

    /**
     * Validate the one-time link and mint a Gemini Live ephemeral token.
     * Body: { t: string }
     */
    POST("/eve/v1/device-support/api/live-token", async (req) => {
      let body: { t?: string };
      try {
        body = (await req.json()) as { t?: string };
      } catch {
        return jsonError("invalid_json", 400);
      }

      const raw = typeof body.t === "string" ? body.t : "";
      const verified = await verifyLinkToken(raw);
      if (!verified.ok) {
        return jsonError(verified.error, verified.status);
      }

      const started = await markLinkStarted(verified.claims.sid);
      if (!started.ok) {
        return jsonError(started.error, started.status);
      }

      try {
        const { token, model } = await mintGeminiEphemeralToken({
          patientName: verified.claims.name,
          reason: verified.claims.reason,
        });
        return Response.json({
          token,
          model,
          patientName: verified.claims.name,
        });
      } catch (err) {
        // Allow retry with the same link if Gemini mint fails.
        await resetLinkToSent(verified.claims.sid);
        const message =
          err instanceof Error ? err.message : "Failed to mint live token";
        console.error("[device-support] live-token mint failed", err);
        if (err instanceof GeminiRateLimitError || /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message)) {
          return jsonError(
            "rate_limited",
            429,
            "The live helper is temporarily rate-limited by Google (429). Wait about a minute, then ask Scout for a fresh link — or raise the Gemini quota / billing tier in Google AI Studio.",
          );
        }
        return jsonError("mint_failed", 502, message);
      }
    }),

    /**
     * Browser reports session outcome; resume WhatsApp Scout session.
     * Body: { t, outcome, summary? }
     */
    POST("/eve/v1/device-support/api/outcome", async (req, { receive, waitUntil }) => {
      let body: {
        t?: string;
        outcome?: string;
        summary?: string | null;
      };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return jsonError("invalid_json", 400);
      }

      const raw = typeof body.t === "string" ? body.t : "";
      const verified = await verifyLinkToken(raw);
      if (!verified.ok) {
        return jsonError(verified.error, verified.status);
      }

      const outcomeRaw = String(body.outcome ?? "").toLowerCase();
      if (!OUTCOMES.has(outcomeRaw as DeviceSupportOutcome)) {
        return jsonError("invalid_outcome", 400);
      }
      const outcome = outcomeRaw as DeviceSupportOutcome;
      const summary =
        typeof body.summary === "string" ? body.summary.slice(0, 800) : null;

      const marked = await markLinkOutcome(
        verified.claims.sid,
        outcome,
        summary,
      );
      if (!marked.ok) {
        return jsonError(marked.error, marked.status);
      }

      const auth: SessionAuthContext = {
        authenticator: "device-support",
        principalType: "runtime",
        principalId: "eve:device-support",
        attributes: {
          phoneNumber: verified.claims.phone,
          conversationId: verified.claims.conversationId,
          sessionId: verified.claims.sid,
          outcome,
        },
      };

      waitUntil(
        (async () => {
          const session = await receive(wassist, {
            message: buildDeviceSupportOutcomeMessage({
              phoneNumber: verified.claims.phone,
              conversationId: verified.claims.conversationId,
              sessionId: verified.claims.sid,
              outcome,
              summary,
              reason: verified.claims.reason,
            }),
            target: { phoneNumber: verified.claims.phone },
            auth,
          });
          await waitForTurnSettlement(session);
        })().catch((err) => {
          console.error("[device-support] outcome resume failed", err);
        }),
      );

      return Response.json({
        ok: true,
        sessionId: verified.claims.sid,
        outcome,
      });
    }),
  ],
});
