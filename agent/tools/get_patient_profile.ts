import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  openHandoffForPhone,
  phoneHasHumanHandoff,
} from "#lib/escalation-queue";
import {
  getPatient,
  isProactiveCheckInDue,
  missingOnboardingFields,
  updatePatient,
} from "#lib/store";

export default defineTool({
  description:
    "Load the patient's coaching profile and onboarding status. Call at the start of every turn. Includes handoffStatus (queue is source of truth — if human, do not coach). Includes emedSetupStatus / emedDeviceLinked — consult Sage for biomarkers only when linked. Scout has no eMed reading tools.",
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
    const openHandoff = openHandoffForPhone(phoneNumber);
    const handoffStatus = phoneHasHumanHandoff(phoneNumber) ? "human" : "ai";
    return {
      phoneNumber: p.phoneNumber,
      onboardingStatus: p.onboardingStatus,
      onboardingComplete: missing.length === 0 && p.onboardingStatus === "complete",
      missingOnboardingFields: missing,
      name: p.name,
      condition: p.condition,
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
      recentSageBriefs: p.sageBriefs.slice(-3),
      emedSetupStatus: p.emedSetupStatus,
      emedDeviceLinked: p.emedSetupStatus === "linked",
      emedDeviceId: p.emedDevice?.deviceId ?? null,
      handoffStatus,
      openEscalation: openHandoff
        ? {
            id: openHandoff.id,
            urgency: openHandoff.urgency,
            summary: openHandoff.summary,
            redFlag: openHandoff.redFlag,
            status: openHandoff.status,
          }
        : null,
      openEscalations: openHandoff
        ? 1
        : p.escalations.filter((e) => e.status === "open" || e.status === "notified")
            .length,
    };
  },
});
