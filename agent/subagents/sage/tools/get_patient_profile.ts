import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  getPatient,
  isProactiveCheckInDue,
  missingOnboardingFields,
} from "#lib/store";

export default defineTool({
  description:
    "Load the patient's profile, recent check-ins, dropout risk, and prior Sage briefs. Call before writing a clinical brief.",
  inputSchema: z.object({
    phoneNumber: z.string().describe("WhatsApp phone in E.164 form"),
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
      checkInFrequency: p.checkInFrequency,
      proactiveCheckInDue: isProactiveCheckInDue(p),
      motivation: p.motivation,
      sideEffectHistory: p.sideEffectHistory,
      dropoutRisk: p.dropoutRisk,
      recentCheckins: p.checkins.slice(-5),
      recentSageBriefs: (p.sageBriefs ?? []).slice(-3),
      openEscalations: p.escalations.filter((e) => e.status === "open").length,
    };
  },
});
