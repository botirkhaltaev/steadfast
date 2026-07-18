import { defineSchedule } from "eve/schedules";
import { runProactiveCheckIn } from "#lib/proactive-checkin";
import { normalizePhone } from "#lib/phone";
import { listConversations } from "#lib/wassist";

/**
 * Daily sweep: for each Wassist conversation, resume the patient session and
 * send a check-in only when onboarding is complete and their chosen frequency
 * says a ping is due (daily / every_few_days / weekly).
 *
 * Cron: every day 09:00 UTC
 */
export default defineSchedule({
  cron: "0 9 * * *",
  async run({ receive, waitUntil, appAuth }) {
    if (!process.env.WASSIST_API_KEY) return;

    const conversations = await listConversations().catch((err) => {
      console.error("[proactive_checkin] listConversations failed", err);
      return null;
    });
    if (!conversations) return;

    for (const conv of conversations) {
      const raw = conv.number ?? conv.phone_number;
      if (!raw || !conv.id) continue;
      const phone = normalizePhone(raw);

      waitUntil(
        runProactiveCheckIn({
          receive,
          auth: appAuth,
          phoneNumber: phone,
          conversationId: conv.id,
        }).catch((err) => {
          console.error("[proactive_checkin] failed", phone, err);
        }),
      );
    }
  },
});
