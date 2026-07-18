import { defineSchedule } from "eve/schedules";
import wassist from "../channels/wassist";
import { listConversations } from "#lib/wassist";
import { normalizePhone } from "#lib/phone";

/**
 * Kick weekly check-in turns for known Wassist conversations.
 * The resumed Eve session (continuation token = phone) decides whether
 * onboarding is complete and calls send_whatsapp_message if so.
 *
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
      const raw = conv.number ?? conv.phone_number;
      if (!raw || !conv.id) continue;
      const phone = normalizePhone(raw);

      waitUntil(
        receive(wassist, {
          message: [
            `[patient_phone=${phone}]`,
            `[conversation_id=${conv.id}]`,
            "[system] Weekly check-in cron.",
            "Call get_patient_profile.",
            "If onboarding is incomplete, do nothing (no patient message).",
            "If onboarding is complete, call send_whatsapp_message with a short warm weekly check-in asking about side effects, doses, and how they feel — then stop.",
          ].join("\n"),
          target: { phoneNumber: phone },
          auth: appAuth,
        })
          .then(() => undefined)
          .catch((err) => {
            console.error("[weekly_checkin] failed", phone, err);
          }),
      );
    }
  },
});
