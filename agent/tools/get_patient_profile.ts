import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient, missingOnboardingFields, updatePatient } from "#lib/store";

export default defineTool({
  description:
    "Load the patient's profile and onboarding status. Call at the start of every turn before coaching or onboarding.",
  inputSchema: z.object({
    phoneNumber: z.string().describe("WhatsApp phone in E.164 form"),
    conversationId: z
      .string()
      .optional()
      .describe("Wassist conversation id if present in the user message"),
  }),
  async execute({ phoneNumber, conversationId }) {
    let p = getPatient(phoneNumber);
    if (conversationId && p.conversationId !== conversationId) {
      p = updatePatient(phoneNumber, { conversationId });
    }
    const missing = missingOnboardingFields(p);
    return {
      phoneNumber: p.phoneNumber,
      onboardingStatus: p.onboardingStatus,
      onboardingComplete: missing.length === 0 && p.onboardingStatus === "complete",
      missingOnboardingFields: missing,
      name: p.name,
      week: p.week,
      dose: p.dose,
      medication: p.medication,
      diet: p.diet,
      proteinTargetG: p.proteinTargetG,
      motivation: p.motivation,
      sideEffectHistory: p.sideEffectHistory,
      dropoutRisk: p.dropoutRisk,
      recentCheckins: p.checkins.slice(-3),
      openEscalations: p.escalations.filter((e) => e.status === "open").length,
    };
  },
});
