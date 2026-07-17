import { defineTool } from "eve/tools";
import { z } from "zod";
import { createEscalation, getPatient } from "#lib/store";

export default defineTool({
  description:
    "Escalate a red-flag symptom to the human clinical team. Creates a prioritized escalation record. Call immediately on severe abdominal pain, persistent vomiting, chest pain, allergic reaction, self-harm ideation, or similar.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    redFlag: z.string().describe("Short label for the red flag"),
    summary: z
      .string()
      .describe("Clinician-facing summary of what the patient reported and context"),
    transcriptSnippet: z.string().describe("Key patient quotes"),
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

    return {
      escalated: true,
      escalationId: card.id,
      messageForPatient:
        "I'm not able to assess this, and it sounds important — I'm connecting you with the clinical team right now.",
    };
  },
});
