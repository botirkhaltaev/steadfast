import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  getPatient,
  isProactiveCheckInDue,
  missingOnboardingFields,
  updatePatient,
} from "#lib/store";

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
    const existing = getPatient(phoneNumber);
    const p =
      conversationId && existing.conversationId !== conversationId
        ? updatePatient(phoneNumber, { conversationId })
        : existing;
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
      lastProactiveCheckInAt: p.lastProactiveCheckInAt ?? null,
      motivation: p.motivation,
      sideEffectHistory: p.sideEffectHistory,
      dropoutRisk: p.dropoutRisk,
      conversationId: p.conversationId ?? null,
      recentCheckins: p.checkins.slice(-3),
      openEscalations: p.escalations.filter((e) => e.status === "open").length,
    };
  },
});
