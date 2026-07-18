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
} from "#lib/store";

export default defineTool({
  description:
    "Load the clinical patient profile: check-ins, dropout risk, prior Sage briefs, eMed setup status, and handoffStatus (human means a clinician owns the WhatsApp thread). Call before writing a brief. Use get_emed_device / get_emed_biomarkers only when emedSetupStatus is linked.",
  inputSchema: z.object({
    phoneNumber: z.string().describe("WhatsApp phone in E.164 form"),
  }),
  async execute({ phoneNumber }) {
    const p = getPatient(phoneNumber);
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
      motivation: p.motivation,
      sideEffectHistory: p.sideEffectHistory,
      dropoutRisk: p.dropoutRisk,
      recentCheckins: p.checkins.slice(-5),
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
