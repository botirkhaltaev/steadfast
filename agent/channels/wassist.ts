import { defineChannel, GET, POST } from "eve/channels";
import { getPatient, listEscalations, updatePatient } from "#lib/store";
import {
  sendViaCallback,
  type WassistWebhookPayload,
} from "#lib/wassist";

type WassistState = {
  phoneNumber: string | null;
  replyCallback: string | null;
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
    const patient = getPatient(phoneNumber);
    return send(input.message, {
      auth: input.auth,
      continuationToken: tokenFor(phoneNumber),
      state: {
        phoneNumber,
        replyCallback: patient.lastReplyCallback ?? null,
      },
      title: patient.name
        ? `WhatsApp ${patient.name}`
        : `WhatsApp ${phoneNumber}`,
    });
  },

  routes: [
    /**
     * Wassist BYOA webhook — WhatsApp is the only UI.
     * POST /eve/v1/wassist/webhook
     */
    POST("/webhook", async (req, { send, waitUntil }) => {
      const body = (await req.json()) as WassistWebhookPayload;
      const phoneNumber = body.phone_number;
      if (!phoneNumber) {
        return Response.json({ error: "phone_number required" }, { status: 400 });
      }

      const text = (body.message ?? "").trim();
      const imageUrl = body.image ?? null;
      const replyCallback = body.reply_callback ?? null;
      const patient = getPatient(phoneNumber);

      updatePatient(phoneNumber, {
        lastReplyCallback: replyCallback ?? undefined,
        conversationId: body.conversation_id ?? undefined,
      });

      const preface = [
        `[patient_phone=${phoneNumber}]`,
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
            },
          },
          continuationToken: tokenFor(phoneNumber),
          state: {
            phoneNumber,
            replyCallback,
          },
          title: patient.name
            ? `WhatsApp ${patient.name}`
            : `WhatsApp ${phoneNumber}`,
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

    GET("/escalations", async () =>
      Response.json({ escalations: listEscalations() }),
    ),
  ],

  events: {
    async "message.completed"(eventData, channel) {
      if (eventData.finishReason === "tool-calls") return;

      const text =
        typeof eventData.message === "string"
          ? eventData.message.trim()
          : "";
      if (!text) return;

      const phoneNumber = channel.state.phoneNumber;
      const patient = phoneNumber ? getPatient(phoneNumber) : null;
      const replyCallback =
        channel.state.replyCallback ?? patient?.lastReplyCallback ?? null;
      if (!replyCallback) {
        console.warn("[wassist] no reply_callback; dropping outbound", {
          phoneNumber,
        });
        return;
      }

      try {
        const imageUrl = patient?.lastMealVisualUrl;
        if (imageUrl && /protein|plate|meal|lunch|upgrade/i.test(text)) {
          await sendViaCallback(replyCallback, {
            content: text,
            imageUrl,
          });
          if (phoneNumber) {
            updatePatient(phoneNumber, { lastMealVisualUrl: undefined });
          }
        } else {
          await sendViaCallback(replyCallback, { content: text });
        }
      } catch (err) {
        console.error("[wassist] reply_callback failed", err);
      }
    },
  },
});
