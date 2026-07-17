import { defineSchedule } from "eve/schedules";
import wassist from "../channels/wassist";
import { listPatients } from "#lib/store";
import { sendViaRest } from "#lib/wassist";

/**
 * Proactive weekly check-in for onboarded patients with an active Wassist conversation.
 * Cron: Mondays 09:00 UTC
 */
export default defineSchedule({
  cron: "0 9 * * 1",
  async run({ receive, waitUntil, appAuth }) {
    if (!process.env.WASSIST_API_KEY) return;

    for (const patient of listPatients()) {
      if (patient.onboardingStatus !== "complete") continue;
      if (!patient.conversationId || !patient.name) continue;

      const med = patient.medication ?? "your medication";
      const message = `Hi ${patient.name} — week ${patient.week ?? "?"} check-in. How has ${med} been this week? Any side effects, missed doses, or questions?`;

      waitUntil(
        sendViaRest({
          conversationId: patient.conversationId,
          content: message,
        })
          .then(() =>
            receive(wassist, {
              message: `[system] Weekly check-in nudge delivered to ${patient.name} (${patient.phoneNumber}). Await their reply; do not message them again until they respond.`,
              target: { phoneNumber: patient.phoneNumber },
              auth: appAuth,
            }),
          )
          .then(() => undefined)
          .catch((err) => {
            console.error("[weekly_checkin] failed", patient.phoneNumber, err);
          }),
      );
    }
  },
});
