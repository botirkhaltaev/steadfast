import { defineChannel, GET, POST } from "eve/channels";
import {
  getEscalation,
  listEscalations,
  resolveEscalation,
  type QueuedEscalation,
} from "#lib/escalation-queue";
import { listMessages, sendMessage } from "#lib/wassist";

/**
 * Demo clinician inbox API — no auth.
 * Mounted under `/eve/v1/clinician/*` so withEve proxies it from Next.js.
 */
function snapshot(card: QueuedEscalation) {
  return {
    id: card.id,
    phoneNumber: card.phoneNumber,
    conversationId: card.conversationId,
    patientName: card.patientName,
    week: card.week,
    dose: card.dose,
    risk: card.risk,
    urgency: card.urgency,
    summary: card.summary,
    transcriptSnippet: card.transcriptSnippet,
    redFlag: card.redFlag,
    status: card.status,
    handoffStatus:
      card.status === "resolved" ? ("ai" as const) : ("human" as const),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

async function readJsonBody(
  req: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  const raw = await req.text().catch(() => null);
  if (raw == null || !raw.trim()) {
    return { ok: true, value: {} };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

export default defineChannel({
  // Browser demo UI may call Eve directly; Next rewrite also works.
  cors: true,
  state: {},
  context() {
    return {};
  },
  routes: [
    GET("/eve/v1/clinician/escalations", async () => {
      const escalations = (await listEscalations()).map(snapshot);
      return Response.json({ escalations });
    }),

    GET("/eve/v1/clinician/escalations/:id", async (_req, { params }) => {
      const id = String(params.id ?? "");
      const card = await getEscalation(id);
      if (!card) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      return Response.json({ escalation: snapshot(card) });
    }),

    GET("/eve/v1/clinician/escalations/:id/messages", async (_req, { params }) => {
      const id = String(params.id ?? "");
      const card = await getEscalation(id);
      if (!card) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      try {
        const messages = await listMessages(card.conversationId);
        return Response.json({
          escalationId: card.id,
          conversationId: card.conversationId,
          messages,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "list_failed";
        console.error("[clinician] list messages failed", detail);
        return Response.json({ error: "wassist_error", detail }, { status: 502 });
      }
    }),

    POST("/eve/v1/clinician/escalations/:id/messages", async (req, { params }) => {
      const id = String(params.id ?? "");
      const card = await getEscalation(id);
      if (!card) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      if (card.status === "resolved") {
        return Response.json(
          { error: "escalation_resolved" },
          { status: 409 },
        );
      }

      const body = await readJsonBody(req);
      if (!body.ok) {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      const text =
        typeof body.value.text === "string" ? body.value.text.trim() : "";
      if (!text) {
        return Response.json({ error: "text_required" }, { status: 400 });
      }

      const outbound = text.startsWith("[Care team]")
        ? text
        : `[Care team] ${text}`;

      try {
        await sendMessage(card.conversationId, { content: outbound });
        return Response.json({
          ok: true,
          escalationId: card.id,
          conversationId: card.conversationId,
          text: outbound,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "send_failed";
        console.error("[clinician] send message failed", detail);
        return Response.json({ error: "wassist_error", detail }, { status: 502 });
      }
    }),

    POST("/eve/v1/clinician/escalations/:id/resolve", async (_req, { params }) => {
      const id = String(params.id ?? "");
      const existing = await getEscalation(id);
      if (!existing) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }

      // Neon queue is source of truth for handoff (no active Eve turn here).
      const card = await resolveEscalation(id);
      if (!card) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }

      return Response.json({
        ok: true,
        escalation: snapshot(card),
        note: "Handoff returned to Scout. Next patient turn will resume AI coaching.",
      });
    }),
  ],
});
