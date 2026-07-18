import { defineChannel, GET, POST } from "eve/channels";
import { toolResultFrom } from "eve/tools";
import { normalizePhone } from "#lib/phone";
import { buildProactiveCheckInMessage } from "#lib/proactive-checkin";
import {
  bumpSessionEpoch,
  getSessionEpoch,
  patientContinuationToken,
} from "#lib/session-epoch";
import { waitForTurnSettlement } from "#lib/session-wait";
import {
  getPatient,
  rememberInboundMessage,
  updatePatient,
} from "#lib/store";
import {
  authenticateWebhook,
  parseWebhookBody,
  sendMessage,
  type QuickReplyButton,
} from "#lib/wassist";
import offerChoices from "../tools/offer_choices";
import generateMealVisual from "../tools/generate_meal_visual";

type ChannelState = {
  phoneNumber: string | null;
  conversationId: string | null;
  messageId: string | null;
  /** True when this WhatsApp message was already handled in a prior turn. */
  duplicate: boolean;
  pendingButtons: QuickReplyButton[] | null;
  pendingImageUrl: string | null;
  pendingTexts: string[];
  sent: boolean;
};

type Target = { phoneNumber: string };
type Ctx = { state: ChannelState };

function initialState(
  phoneNumber: string | null = null,
  conversationId: string | null = null,
  messageId: string | null = null,
): ChannelState {
  return {
    phoneNumber,
    conversationId,
    messageId,
    duplicate: false,
    pendingButtons: null,
    pendingImageUrl: null,
    pendingTexts: [],
    sent: false,
  };
}

function hasModelCredentials(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.VERCEL,
  );
}

function buildUserContent(input: {
  phoneNumber: string;
  conversationId: string;
  text: string;
  imageUrl: string | null;
}) {
  const preface = [
    `[patient_phone=${input.phoneNumber}]`,
    `[conversation_id=${input.conversationId}]`,
    input.imageUrl ? `[meal_image_url=${input.imageUrl}]` : null,
    input.text || (input.imageUrl ? "I sent a photo of my meal." : "Hi"),
  ]
    .filter(Boolean)
    .join("\n");

  if (!input.imageUrl) return preface;

  return [
    { type: "text" as const, text: preface },
    {
      type: "file" as const,
      data: new URL(input.imageUrl),
      mediaType: "image/jpeg",
    },
  ];
}

async function flush(channel: { state: ChannelState }, fallbackText?: string) {
  const { state } = channel;
  if (state.duplicate || state.sent) return;

  const conversationId = state.conversationId;
  if (!conversationId) {
    console.warn("[wassist] missing conversationId; drop outbound", {
      phoneNumber: state.phoneNumber,
    });
    return;
  }

  const content =
    state.pendingTexts
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n") || fallbackText;

  if (!content) return;

  const buttons = state.pendingButtons;
  const imageUrl = state.pendingImageUrl;
  state.pendingButtons = null;
  state.pendingImageUrl = null;
  state.pendingTexts = [];
  state.sent = true;

  await sendMessage(conversationId, {
    content,
    ...(buttons?.length ? { buttons } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  });
}

export default defineChannel<ChannelState, Ctx, Target>({
  cors: false,
  state: initialState(),

  context(state) {
    return { state };
  },

  metadata(state) {
    return {
      phoneNumber: state.phoneNumber,
      conversationId: state.conversationId,
    };
  },

  async receive(input, { send }) {
    const phoneNumber = normalizePhone(input.target.phoneNumber);
    return send(input.message, {
      auth: input.auth,
      continuationToken: patientContinuationToken(phoneNumber),
      state: initialState(phoneNumber),
      title: `WhatsApp ${phoneNumber}`,
    });
  },

  routes: [
    /**
     * Wassist platform webhook.
     * Mounted at POST /webhook (Eve custom channels keep authored paths).
     */
    POST("/webhook", async (req, { send, waitUntil }) => {
      const rawBody = await req.text().catch(() => null);
      if (rawBody == null) {
        return Response.json({ error: "invalid body" }, { status: 400 });
      }

      if (!authenticateWebhook(req, rawBody)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      const json = (() => {
        try {
          return { ok: true as const, value: JSON.parse(rawBody) as unknown };
        } catch {
          return { ok: false as const };
        }
      })();
      if (!json.ok) {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }

      const parsed = parseWebhookBody(json.value);
      if (parsed.kind === "error") {
        return Response.json({ error: parsed.error }, { status: 400 });
      }
      if (parsed.kind === "ignored") {
        return Response.json({ ok: true, ignored: parsed.event });
      }

      const inbound = parsed.message;

      if (!hasModelCredentials()) {
        waitUntil(
          sendMessage(inbound.conversationId, {
            content:
              "Scout & Sage isn't fully configured yet. Please try again shortly.",
          }).catch((err) => {
            console.error("[wassist] config notice failed", err);
          }),
        );
        return Response.json({ ok: true });
      }

      // Ack within Wassist's window; coach reply is sent from turn.completed.
      waitUntil(
        send(buildUserContent(inbound), {
          auth: {
            authenticator: "wassist",
            principalType: "user",
            principalId: inbound.phoneNumber,
            attributes: {
              phoneNumber: inbound.phoneNumber,
              conversationId: inbound.conversationId,
              messageId: inbound.messageId,
            },
          },
          continuationToken: patientContinuationToken(inbound.phoneNumber),
          state: initialState(
            inbound.phoneNumber,
            inbound.conversationId,
            inbound.messageId,
          ),
          title: `WhatsApp ${inbound.phoneNumber}`,
        }).then(() => undefined),
      );

      return Response.json({ ok: true });
    }),

    GET("/health", async () =>
      Response.json({
        ok: true,
        service: "scout-sage-wassist",
        webhook: "/webhook",
        resetAll: "/reset-all",
        sessionEpoch: getSessionEpoch(),
        authConfigured: Boolean(process.env.WASSIST_WEBHOOK_SECRET),
        modelConfigured: hasModelCredentials(),
      }),
    ),

    /**
     * Demo: wipe all patient sessions by bumping the session epoch.
     * Next WhatsApp message for any phone starts a blank onboarding profile.
     * Header: x-demo-reset-secret: <DEMO_RESET_SECRET>
     */
    POST("/reset-all", async (req) => {
      const secret = process.env.DEMO_RESET_SECRET?.trim();
      if (!secret) {
        return Response.json(
          { error: "DEMO_RESET_SECRET is not configured" },
          { status: 503 },
        );
      }
      const provided = req.headers.get("x-demo-reset-secret")?.trim() ?? "";
      if (provided !== secret) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      const previousEpoch = getSessionEpoch();
      const sessionEpoch = bumpSessionEpoch();

      console.info("[wassist] reset-all", { previousEpoch, sessionEpoch });
      return Response.json({
        ok: true,
        reset: "all",
        previousEpoch,
        sessionEpoch,
        note: "All phones will start a fresh Eve session on their next WhatsApp message.",
      });
    }),

    /**
     * Demo / ops: force a proactive check-in for one patient.
     * Same HMAC auth as /webhook.
     * Body: { phone_number, conversation_id }
     */
    POST("/proactive-checkin", async (req, { send, waitUntil }) => {
      const rawBody = await req.text().catch(() => null);
      if (rawBody == null) {
        return Response.json({ error: "invalid body" }, { status: 400 });
      }
      if (!authenticateWebhook(req, rawBody)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      const json = (() => {
        try {
          return { ok: true as const, value: JSON.parse(rawBody) as Record<string, unknown> };
        } catch {
          return { ok: false as const };
        }
      })();
      if (!json.ok) {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }

      const phoneNumber = normalizePhone(String(json.value.phone_number ?? ""));
      if (!phoneNumber) {
        return Response.json({ error: "phone_number required" }, { status: 400 });
      }

      const conversationId =
        typeof json.value.conversation_id === "string"
          ? json.value.conversation_id.trim()
          : "";
      if (!conversationId) {
        return Response.json(
          { error: "conversation_id required" },
          { status: 400 },
        );
      }

      waitUntil(
        (async () => {
          const session = await send(
            buildProactiveCheckInMessage({
              phoneNumber,
              conversationId,
              force: true,
            }),
            {
              auth: {
                authenticator: "app",
                principalType: "runtime",
                principalId: "eve:app",
                attributes: {
                  phoneNumber,
                  conversationId,
                },
              },
              continuationToken: patientContinuationToken(phoneNumber),
              state: initialState(phoneNumber, conversationId),
              title: `WhatsApp ${phoneNumber}`,
            },
          );
          await waitForTurnSettlement(session);
        })().catch((err) => {
          console.error("[wassist] proactive-checkin failed", err);
        }),
      );

      return Response.json({ ok: true, phoneNumber, conversationId });
    }),
  ],

  events: {
    "turn.started"(_eventData, channel) {
      channel.state.pendingTexts = [];
      channel.state.pendingButtons = null;
      channel.state.pendingImageUrl = null;
      channel.state.sent = false;
      channel.state.duplicate = false;

      const { phoneNumber, conversationId, messageId } = channel.state;

      if (phoneNumber && conversationId) {
        try {
          getPatient(phoneNumber);
          updatePatient(phoneNumber, { conversationId });
        } catch (err) {
          console.warn("[wassist] conversationId persist failed", err);
        }
      }

      if (phoneNumber && messageId) {
        // Same WhatsApp message must not run two coach turns.
        channel.state.duplicate = !rememberInboundMessage(phoneNumber, messageId);
        if (channel.state.duplicate) {
          console.info("[wassist] duplicate message skipped", {
            phoneNumber,
            messageId,
          });
        }
      }
    },

    "action.result"(eventData, channel) {
      if (channel.state.duplicate) return;

      const choices = toolResultFrom(eventData.result, offerChoices);
      if (choices?.output?.buttons?.length) {
        channel.state.pendingButtons = choices.output.buttons;
      }

      const meal = toolResultFrom(eventData.result, generateMealVisual);
      if (meal?.output?.imageUrl) {
        channel.state.pendingImageUrl = meal.output.imageUrl;
      }
    },

    "message.completed"(eventData, channel) {
      if (channel.state.duplicate) return;
      if (eventData.finishReason === "tool-calls") return;

      const text =
        typeof eventData.message === "string"
          ? eventData.message.trim()
          : "";
      if (!text) return;
      channel.state.pendingTexts = [...channel.state.pendingTexts, text];
    },

    async "turn.completed"(_eventData, channel) {
      try {
        await flush(channel);
      } catch (err) {
        console.error("[wassist] turn.completed send failed", err);
      }
    },

    async "turn.failed"(eventData, channel) {
      if (channel.state.duplicate) return;
      if (!channel.state.conversationId) return;
      const detail =
        typeof eventData.message === "string"
          ? eventData.message
          : "something went wrong on my side";
      // Hook / race failures often surface here with no coach text — stay silent.
      if (channel.state.pendingTexts.length === 0 && /hookconflict/i.test(detail)) {
        console.info("[wassist] turn.failed silent (hook conflict)", {
          phoneNumber: channel.state.phoneNumber,
          messageId: channel.state.messageId,
        });
        return;
      }
      channel.state.pendingTexts = [
        `Sorry — ${detail}. Please try again in a moment. If you feel unwell, contact your clinician or emergency services.`,
      ];
      try {
        await flush(channel);
      } catch (err) {
        console.error("[wassist] turn.failed send failed", err);
      }
    },

    async "session.failed"(_eventData, channel) {
      if (channel.state.duplicate) return;
      if (!channel.state.conversationId) return;
      // Racing second delivery (HookConflict) must not spam an apology.
      // Only flush coach text already buffered; never invent a new message.
      if (channel.state.pendingTexts.length === 0) {
        console.info("[wassist] session.failed silent", {
          phoneNumber: channel.state.phoneNumber,
          messageId: channel.state.messageId,
        });
        return;
      }
      try {
        await flush(channel);
      } catch (err) {
        console.error("[wassist] session.failed send failed", err);
      }
    },
  },
});
