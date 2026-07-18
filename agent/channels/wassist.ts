import { defineChannel, GET, POST } from "eve/channels";
import { toolResultFrom } from "eve/tools";
import { isAllowedReplyCallback } from "#lib/callback-url";
import {
  abandonDelivery,
  armDeliveryWait,
  createDeliveryKey,
  signalDelivery,
  wasDeliveryAbandoned,
} from "#lib/delivery-wait";
import { normalizePhone } from "#lib/phone";
import {
  deliverOutbound,
  normalizeInboundWebhook,
  verifyWebhookSecret,
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
  deliveryKey: string | null;
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

const DELIVERY_TIMEOUT_MS = 50_000;

function tokenFor(phoneNumber: string) {
  return normalizePhone(phoneNumber);
}

function freshState(
  phoneNumber: string | null,
  replyCallback: string | null = null,
  conversationId: string | null = null,
  deliveryKey: string | null = null,
): WassistState {
  return {
    phoneNumber,
    replyCallback,
    conversationId,
    deliveryKey,
    pendingButtons: null,
    pendingImageUrl: null,
    pendingTexts: [],
    deliveredThisTurn: false,
  };
}

function hasModelCredentials(): boolean {
  // On Vercel, AI Gateway can authenticate via project OIDC without a raw key.
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.VERCEL,
  );
}

async function flushOutbound(
  channel: { state: WassistState },
  opts?: { fallbackText?: string; outcome?: "delivered" | "failed" },
) {
  const deliveryKey = channel.state.deliveryKey;
  const outcome = opts?.outcome ?? "delivered";

  if (wasDeliveryAbandoned(deliveryKey)) {
    // Webhook already sent a timeout apology; do not double-message.
    return;
  }

  if (channel.state.deliveredThisTurn) {
    signalDelivery(deliveryKey, outcome);
    return;
  }

  const replyCallback = channel.state.replyCallback;
  const conversationId = channel.state.conversationId;
  if (!replyCallback && !conversationId) {
    console.warn("[wassist] no reply_callback/conversationId; dropping outbound", {
      phoneNumber: channel.state.phoneNumber,
    });
    signalDelivery(deliveryKey, "failed");
    return;
  }

  const text =
    channel.state.pendingTexts
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n") || opts?.fallbackText;

  if (!text) {
    signalDelivery(deliveryKey, outcome === "failed" ? "failed" : "delivered");
    return;
  }

  const buttons = channel.state.pendingButtons;
  const imageUrl = channel.state.pendingImageUrl;

  channel.state.pendingButtons = null;
  channel.state.pendingImageUrl = null;
  channel.state.pendingTexts = [];
  channel.state.deliveredThisTurn = true;

  try {
    await deliverOutbound(
      { replyCallback, conversationId },
      {
        content: text,
        ...(buttons?.length ? { buttons } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
    );
    signalDelivery(deliveryKey, outcome);
  } catch (err) {
    channel.state.deliveredThisTurn = false;
    signalDelivery(deliveryKey, "failed");
    throw err;
  }
}

export default defineChannel<WassistState, WassistCtx, WassistTarget>({
  // Server-to-server webhook — no browser CORS needed.
  cors: false,
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
     * Wassist inbound webhook — WhatsApp is the only patient UI.
     * Accepts BYOA `{phone_number,…}` and platform `message.received` events.
     * Mounted at POST /webhook (Eve custom channels use authored paths as-is).
     */
    POST("/webhook", async (req, { send, waitUntil }) => {
      let rawBody: string;
      try {
        rawBody = await req.text();
      } catch {
        return Response.json({ error: "invalid body" }, { status: 400 });
      }

      if (!verifyWebhookSecret(req, rawBody)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }

      const inbound = normalizeInboundWebhook(parsed);
      if ("error" in inbound) {
        return Response.json({ error: inbound.error }, { status: 400 });
      }

      // test.ping / subscription lifecycle / unknown events — ack only.
      if (inbound.ignore) {
        return Response.json({ ok: true, ignored: inbound.event });
      }

      const { phoneNumber, imageUrl, replyCallback, conversationId } = inbound;
      const text = inbound.text;

      if (replyCallback && !isAllowedReplyCallback(replyCallback)) {
        console.warn("[wassist] rejected reply_callback host", {
          phoneNumber,
          host: (() => {
            try {
              return new URL(replyCallback).host;
            } catch {
              return "invalid";
            }
          })(),
        });
        return Response.json({ error: "invalid reply_callback" }, { status: 400 });
      }

      if (imageUrl) {
        try {
          const parsedUrl = new URL(imageUrl);
          if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
            return Response.json({ error: "invalid image url" }, { status: 400 });
          }
        } catch {
          return Response.json({ error: "invalid image url" }, { status: 400 });
        }
      }

      const canDeliver = Boolean(replyCallback || conversationId);

      // Fail fast when the model cannot run — avoid 50s hangs on misconfigured deploys.
      if (!hasModelCredentials() && canDeliver) {
        waitUntil(
          deliverOutbound(
            { replyCallback, conversationId },
            {
              content:
                "Steadfast isn't fully configured yet (missing model credentials). Please try again shortly.",
            },
          ).catch((err) => {
            console.error("[wassist] config error delivery failed", err);
          }),
        );
        return Response.json({ ok: true });
      }

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

      const deliveryKey = createDeliveryKey(phoneNumber);

      // Critical: waitUntil must cover flushOutbound. send() resolves early;
      // getEventStream replay is the wrong signal (stale session.waiting).
      // Channel handlers signal this latch after WhatsApp delivery completes.
      waitUntil(
        (async () => {
          const delivery = armDeliveryWait(deliveryKey);

          await send(content, {
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
            state: freshState(
              phoneNumber,
              replyCallback,
              conversationId,
              deliveryKey,
            ),
            title: `WhatsApp ${phoneNumber}`,
          });

          const outcome = await Promise.race([
            delivery,
            new Promise<"timeout">((resolve) => {
              setTimeout(() => resolve("timeout"), DELIVERY_TIMEOUT_MS);
            }),
          ]);

          if (outcome === "timeout" && canDeliver && abandonDelivery(deliveryKey)) {
            try {
              await deliverOutbound(
                { replyCallback, conversationId },
                {
                  content:
                    "Sorry — I'm taking longer than expected. Please send that again in a moment. If you feel unwell, contact your clinician or emergency services.",
                },
              );
            } catch (err) {
              console.error("[wassist] timeout fallback delivery failed", err);
            }
          }
        })(),
      );

      // Ack fast; coach reply flushes on turn.completed via callback or REST.
      return Response.json({ ok: true });
    }),

    GET("/health", async () =>
      Response.json({
        ok: true,
        service: "steadfast-wassist",
        webhook: "/webhook",
        authConfigured: Boolean(process.env.WASSIST_WEBHOOK_SECRET),
        modelConfigured: hasModelCredentials(),
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
        signalDelivery(channel.state.deliveryKey, "failed");
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
        await flushOutbound(channel, { outcome: "failed" });
      } catch (err) {
        console.error("[wassist] turn.failed delivery failed", err);
        signalDelivery(channel.state.deliveryKey, "failed");
      }
    },

    async "session.failed"(_eventData, channel) {
      channel.state.pendingTexts = [
        "Sorry — I'm having trouble right now. Please try again shortly. If this is urgent, contact your clinician or emergency services.",
      ];
      try {
        await flushOutbound(channel, { outcome: "failed" });
      } catch (err) {
        console.error("[wassist] session.failed delivery failed", err);
        signalDelivery(channel.state.deliveryKey, "failed");
      }
    },
  },
});
