import { defineTool } from "eve/tools";
import { z } from "zod";
import { notifyClinicians } from "#lib/notify";
import {
  createEscalation,
  getPatient,
  markEscalationNotified,
} from "#lib/store";

/**
 * DEFERRED — human clinician handoff is not live.
 * Scout must consult the sage subagent for red flags / clinical review instead.
 * Kept for a future human escalation path.
 */
export default defineTool({
  description:
    "DEFERRED — do not use. Human clinician handoff is not implemented yet. For red flags and clinical review, consult the sage subagent instead.",
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
      deferred: true,
      note: "Human handoff is deferred — prefer sage subagent for live clinical path.",
      escalationId: card.id,
      clinicianNotified: notifyResult.notified,
      notifyChannel: notifyResult.channel,
      notifyDetail: notifyResult.detail,
      messageForPatient:
        "I'm not able to assess this safely on my own — please seek emergency care if you feel unsafe, and I'll take guidance from Sage on next steps.",
    };
  },
});
