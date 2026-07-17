import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient, missingOnboardingFields } from "#lib/store";

export default defineTool({
  description:
    "Load the patient's profile and onboarding status. Call at the start of every turn before coaching.",
  inputSchema: z.object({
    phoneNumber: z
      .string()
      .describe("Patient WhatsApp phone number in E.164 form"),
  }),
  async execute({ phoneNumber }) {
    const p = getPatient(phoneNumber);
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
      openEscalations: p.escalations.length,
    };
  },
});
