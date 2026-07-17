import { defineSchedule } from "eve/schedules";
import wassist from "../channels/wassist";
import { listConversations, sendViaRest } from "#lib/wassist";

/**
 * Proactive weekly check-in for active Wassist conversations.
 * Cron: Mondays 09:00 UTC
 */
export default defineSchedule({
  cron: "0 9 * * 1",
  async run({ receive, waitUntil, appAuth }) {
    if (!process.env.WASSIST_API_KEY) return;

    let conversations: Awaited<ReturnType<typeof listConversations>> = [];
    try {
      conversations = await listConversations();
    } catch (err) {
      console.error("[weekly_checkin] listConversations failed", err);
      return;
    }

    for (const conv of conversations) {
      const phone = conv.number ?? conv.phone_number;
      if (!phone || !conv.id) continue;

      const message =
        "Hi — it's your Steadfast weekly check-in. How has your GLP-1 week been? Any side effects, missed doses, or questions?";

      waitUntil(
        sendViaRest({
          conversationId: conv.id,
          content: message,
        })
          .then(() =>
            receive(wassist, {
              message: `[system] Weekly check-in nudge delivered to ${phone}. Await their reply; do not message again until they respond.`,
              target: { phoneNumber: phone },
              auth: appAuth,
            }),
          )
          .then(() => undefined)
          .catch((err) => {
            console.error("[weekly_checkin] failed", phone, err);
          }),
      );
    }
  },
});
