import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  markQueuedNotified,
  upsertEscalation,
} from "#lib/escalation-queue";
import { notifyClinicians } from "#lib/notify";
import {
  createEscalation,
  getPatient,
  markEscalationNotified,
  updatePatient,
} from "#lib/store";

/**
 * Hand the WhatsApp thread to a human clinician (clinician inbox).
 * Prefer consulting Sage first for clinical framing; call this when a human
 * must join (red flags, Sage recommends handoff, or patient asks for a person).
 */
export default defineTool({
  description:
    "Escalate to a human clinician and pause AI coaching on this WhatsApp thread. Creates an inbox case clinicians can chat into. Call after red flags (with emergency-care advice first), when Sage recommends a human, or when the patient asks for a person. Pass conversationId from the profile/message.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    conversationId: z
      .string()
      .describe("Wassist conversation id for the WhatsApp thread"),
    redFlag: z.string(),
    summary: z.string(),
    transcriptSnippet: z.string(),
    urgency: z.enum(["routine", "urgent", "emergency"]).default("urgent"),
  }),
  async execute({
    phoneNumber,
    conversationId,
    redFlag,
    summary,
    transcriptSnippet,
    urgency,
  }) {
    const convId = conversationId.trim();
    if (!convId) {
      throw new Error("conversationId is required for human handoff");
    }

    const patient = getPatient(phoneNumber);
    if (patient.conversationId !== convId) {
      updatePatient(phoneNumber, { conversationId: convId });
    }

    const card = createEscalation({
      phoneNumber,
      conversationId: convId,
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

    await upsertEscalation({
      id: card.id,
      phoneNumber: card.phoneNumber,
      conversationId: card.conversationId,
      patientName: card.patientName,
      week: card.week,
      dose: card.dose,
      risk: card.risk,
      urgency: card.urgency,
      summary: card.summary,
      transcriptSnippet: card.transcriptSnippet,
      redFlag: card.redFlag,
      status: "open",
    });

    const notifyResult = await notifyClinicians(card)
      .then(async (result) => {
        if (result.notified) {
          markEscalationNotified(phoneNumber, card.id);
          await markQueuedNotified(card.id);
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
      handoffStatus: "human" as const,
      escalationId: card.id,
      clinicianNotified: notifyResult.notified,
      notifyChannel: notifyResult.channel,
      notifyDetail: notifyResult.detail,
      messageForPatient:
        "I'm connecting you with a human clinician from the care team now — they'll message you here on WhatsApp shortly. If you feel unsafe, seek emergency care immediately.",
    };
  },
});
