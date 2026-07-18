import { defineChannel, GET, POST } from "eve/channels";
import { toolResultFrom } from "eve/tools";
import { normalizePhone } from "#lib/phone";
import { waitForTurnSettlement } from "#lib/session-wait";
import {
  sendViaCallback,
  verifyWebhookSecret,
  type WassistWebhookPayload,
} from "#lib/wassist";
import offerChoices from "../tools/offer_choices";
import generateMealVisual from "../tools/generate_meal_visual";

type QuickReplyButton = {
  type: "quick_reply";
  text: string;
  quickReplyId: string;
};

type WassistState = {
  phoneNumber: string | null;
  replyCallback: string | null;
  conversationId: string | null;
  pendingButtons: QuickReplyButton[] | null;
  pendingImageUrl: string | null;
  /** Assembled assistant texts for this turn (sent once on turn.completed). */
  pendingTexts: string[];
  deliveredThisTurn: boolean;
};

type WassistTarget = {
  phoneNumber: string;
};

type WassistCtx = {
  state: WassistState;
};

function tokenFor(phoneNumber: string) {
  return normalizePhone(phoneNumber);
}

function freshState(
  phoneNumber: string | null,
  replyCallback: string | null = null,
  conversationId: string | null = null,
): WassistState {
  return {
    phoneNumber,
    replyCallback,
    conversationId,
    pendingButtons: null,
    pendingImageUrl: null,
    pendingTexts: [],
    deliveredThisTurn: false,
  };
}

async function flushOutbound(
  channel: { state: WassistState },
  opts?: { fallbackText?: string },
) {
  if (channel.state.deliveredThisTurn) return;

  const replyCallback = channel.state.replyCallback;
  if (!replyCallback) {
    console.warn("[wassist] no reply_callback; dropping outbound", {
      phoneNumber: channel.state.phoneNumber,
    });
    return;
  }

  const text =
    channel.state.pendingTexts
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n") || opts?.fallbackText;

  if (!text) return;

  const buttons = channel.state.pendingButtons;
  const imageUrl = channel.state.pendingImageUrl;

  channel.state.pendingButtons = null;
  channel.state.pendingImageUrl = null;
  channel.state.pendingTexts = [];
  channel.state.deliveredThisTurn = true;

  await sendViaCallback(replyCallback, {
    content: text,
    ...(buttons?.length ? { buttons } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  });
}

export default defineChannel<WassistState, WassistCtx, WassistTarget>({
  cors: true,
  state: freshState(null),

  context(state) {
    return { state };
  },

  metadata(state) {
    return {
      phoneNumber: state.phoneNumber,
      hasCallback: Boolean(state.replyCallback),
    };
  },

  async receive(input, { send }) {
    const phoneNumber = normalizePhone(input.target.phoneNumber);
    return send(input.message, {
      auth: input.auth,
      continuationToken: tokenFor(phoneNumber),
      state: freshState(phoneNumber),
      title: `WhatsApp ${phoneNumber}`,
    });
  },

  routes: [
    /**
     * Wassist BYOA webhook — WhatsApp is the only patient UI.
     * Mounted at POST /webhook (Eve custom channels use authored paths as-is).
     */
    POST("/webhook", async (req, { send, waitUntil }) => {
      if (!verifyWebhookSecret(req)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      const body = (await req.json()) as WassistWebhookPayload;
      const phoneNumber = normalizePhone(body.phone_number ?? "");
      if (!phoneNumber) {
        return Response.json({ error: "phone_number required" }, { status: 400 });
      }

      const text = (body.message ?? "").trim();
      const imageUrl = body.image ?? null;
      const replyCallback = body.reply_callback ?? null;
      const conversationId = body.conversation_id ?? null;

      const preface = [
        `[patient_phone=${phoneNumber}]`,
        conversationId ? `[conversation_id=${conversationId}]` : null,
        imageUrl ? `[meal_image_url=${imageUrl}]` : null,
        text || (imageUrl ? "I sent a photo of my meal." : "Hi"),
      ]
        .filter(Boolean)
        .join("\n");

      const content = imageUrl
        ? [
            { type: "text" as const, text: preface },
            {
              type: "file" as const,
              data: new URL(imageUrl),
              mediaType: "image/jpeg",
            },
          ]
        : preface;

      // Critical: waitUntil must cover the full turn. send() resolves early;
      // without waiting for settlement, Vercel can freeze before reply_callback.
      waitUntil(
        (async () => {
          const session = await send(content, {
            auth: {
              authenticator: "wassist",
              principalType: "user",
              principalId: phoneNumber,
              attributes: {
                phoneNumber,
                replyCallback: replyCallback ?? "",
                conversationId: conversationId ?? "",
              },
            },
            continuationToken: tokenFor(phoneNumber),
            state: freshState(phoneNumber, replyCallback, conversationId),
            title: `WhatsApp ${phoneNumber}`,
          });

          const outcome = await waitForTurnSettlement(session);
          if (outcome === "timeout" && replyCallback) {
            // Channel events may not have flushed; last-resort patient-visible message.
            try {
              await sendViaCallback(replyCallback, {
                content:
                  "Sorry — I'm taking longer than expected. Please send that again in a moment. If you feel unwell, contact your clinician or emergency services.",
              });
            } catch (err) {
              console.error("[wassist] timeout fallback callback failed", err);
            }
          }
        })(),
      );

      // No customer-visible ack; coach reply flushes on turn.completed via callback.
      return Response.json({ content: "No CUSTOMER message reply" });
    }),

    GET("/health", async () =>
      Response.json({
        ok: true,
        service: "steadfast-wassist",
        webhook: "/webhook",
        authConfigured: Boolean(process.env.WASSIST_WEBHOOK_SECRET),
      }),
    ),
  ],

  events: {
    "turn.started"(_eventData, channel) {
      channel.state.pendingTexts = [];
      channel.state.pendingButtons = null;
      channel.state.pendingImageUrl = null;
      channel.state.deliveredThisTurn = false;
    },

    "action.result"(eventData, channel) {
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
      // Skip interim narration before tool calls; buffer terminal text for turn flush.
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
        await flushOutbound(channel);
      } catch (err) {
        console.error("[wassist] turn.completed delivery failed", err);
      }
    },

    async "turn.failed"(eventData, channel) {
      const detail =
        typeof eventData.message === "string"
          ? eventData.message
          : "something went wrong on my side";
      channel.state.pendingTexts = [
        `Sorry — ${detail}. Please try again in a moment. If you feel unwell, contact your clinician or emergency services.`,
      ];
      try {
        await flushOutbound(channel);
      } catch (err) {
        console.error("[wassist] turn.failed delivery failed", err);
      }
    },

    async "session.failed"(eventData, channel) {
      channel.state.pendingTexts = [
        "Sorry — I'm having trouble right now. Please try again shortly. If this is urgent, contact your clinician or emergency services.",
      ];
      try {
        await flushOutbound(channel);
      } catch (err) {
        console.error("[wassist] session.failed delivery failed", err);
      }
    },
  },
});
