import { defineTool } from "eve/tools";
import { z } from "zod";
import { notifyClinicians } from "#lib/notify";
import {
  createEscalation,
  getPatient,
  markEscalationNotified,
} from "#lib/store";

export default defineTool({
  description:
    "Escalate a red-flag symptom to the human clinical team. Notifies the clinician webhook when configured, and stores a durable escalation card. Call immediately on severe abdominal pain, persistent vomiting, chest pain, allergic reaction, self-harm ideation, or similar.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    redFlag: z.string(),
    summary: z.string(),
    transcriptSnippet: z.string(),
    urgency: z.enum(["routine", "urgent", "emergency"]).default("urgent"),
  }),
  async execute({ phoneNumber, redFlag, summary, transcriptSnippet, urgency }) {
    const patient = getPatient(phoneNumber);
    const card = createEscalation({
      phoneNumber,
      patientName: patient.name ?? "Unknown",
      week: patient.week,
      dose:
        patient.medication && patient.dose
          ? `${patient.medication} ${patient.dose}`
          : patient.medication ?? patient.dose,
      risk: patient.dropoutRisk,
      urgency,
      summary,
      transcriptSnippet,
      redFlag,
    });

    const notifyResult = await notifyClinicians(card)
      .then((result) => {
        if (result.notified) {
          markEscalationNotified(phoneNumber, card.id);
        }
        return result;
      })
      .catch((err: unknown) => ({
        notified: false as const,
        channel: "none" as const,
        detail: err instanceof Error ? err.message : "notify_failed",
      }));

    return {
      escalated: true,
      escalationId: card.id,
      clinicianNotified: notifyResult.notified,
      notifyChannel: notifyResult.channel,
      notifyDetail: notifyResult.detail,
      messageForPatient:
        "I'm not able to assess this, and it sounds important — I'm connecting you with the clinical team right now.",
    };
  },
});
