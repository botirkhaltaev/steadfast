import { defineChannel, GET, POST } from "eve/channels";
import { toolResultFrom } from "eve/tools";
import { sendViaCallback, type WassistWebhookPayload } from "#lib/wassist";
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
  pendingButtons: QuickReplyButton[] | null;
  pendingImageUrl: string | null;
};

type WassistTarget = {
  phoneNumber: string;
};

type WassistCtx = {
  state: WassistState;
};

function tokenFor(phoneNumber: string) {
  return phoneNumber;
}

export default defineChannel<WassistState, WassistCtx, WassistTarget>({
  cors: true,
  state: {
    phoneNumber: null,
    replyCallback: null,
    pendingButtons: null,
    pendingImageUrl: null,
  },

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
    const phoneNumber = input.target.phoneNumber;
    return send(input.message, {
      auth: input.auth,
      continuationToken: tokenFor(phoneNumber),
      state: {
        phoneNumber,
        replyCallback: null,
        pendingButtons: null,
        pendingImageUrl: null,
      },
      title: `WhatsApp ${phoneNumber}`,
    });
  },

  routes: [
    POST("/webhook", async (req, { send, waitUntil }) => {
      const body = (await req.json()) as WassistWebhookPayload;
      const phoneNumber = body.phone_number;
      if (!phoneNumber) {
        return Response.json({ error: "phone_number required" }, { status: 400 });
      }

      const text = (body.message ?? "").trim();
      const imageUrl = body.image ?? null;
      const replyCallback = body.reply_callback ?? null;

      const preface = [
        `[patient_phone=${phoneNumber}]`,
        body.conversation_id
          ? `[conversation_id=${body.conversation_id}]`
          : null,
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

      waitUntil(
        send(content, {
          auth: {
            authenticator: "wassist",
            principalType: "user",
            principalId: phoneNumber,
            attributes: {
              phoneNumber,
              replyCallback: replyCallback ?? "",
              conversationId: body.conversation_id ?? "",
            },
          },
          continuationToken: tokenFor(phoneNumber),
          state: {
            phoneNumber,
            replyCallback,
            pendingButtons: null,
            pendingImageUrl: null,
          },
          title: `WhatsApp ${phoneNumber}`,
        }).then(() => undefined),
      );

      return Response.json({ content: "No CUSTOMER message reply" });
    }),

    GET("/health", async () =>
      Response.json({
        ok: true,
        service: "steadfast-wassist",
        webhook: "/eve/v1/wassist/webhook",
      }),
    ),
  ],

  events: {
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

    async "message.completed"(eventData, channel) {
      if (eventData.finishReason === "tool-calls") return;

      const text =
        typeof eventData.message === "string"
          ? eventData.message.trim()
          : "";
      if (!text) return;

      const replyCallback = channel.state.replyCallback;
      if (!replyCallback) {
        console.warn("[wassist] no reply_callback; dropping outbound", {
          phoneNumber: channel.state.phoneNumber,
        });
        return;
      }

      const buttons = channel.state.pendingButtons;
      const imageUrl = channel.state.pendingImageUrl;
      channel.state.pendingButtons = null;
      channel.state.pendingImageUrl = null;

      try {
        await sendViaCallback(replyCallback, {
          content: text,
          ...(buttons?.length ? { buttons } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        });
      } catch (err) {
        console.error("[wassist] reply_callback failed", err);
      }
    },
  },
});
