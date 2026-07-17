import { defineTool } from "eve/tools";
import { z } from "zod";
import { addCheckIn, computeRiskScore, getPatient, updatePatient } from "#lib/store";

export default defineTool({
  description:
    "Persist a structured weekly check-in after onboarding is complete. Updates dropout risk.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    sideEffectSeverity: z.number().min(0).max(10).optional(),
    missedDoses: z.number().min(0).max(7).optional(),
    mood: z.string().optional(),
    notes: z.string().optional(),
    proteinEstimateG: z.number().optional(),
    resistanceSessions: z.number().optional(),
  }),
  async execute(input) {
    const existing = getPatient(input.phoneNumber);
    if (existing.onboardingStatus !== "complete") {
      throw new Error("Onboarding incomplete — finish onboarding before logging check-ins");
    }

    const checkin = {
      at: new Date().toISOString(),
      sideEffectSeverity: input.sideEffectSeverity,
      missedDoses: input.missedDoses,
      mood: input.mood,
      notes: input.notes,
      proteinEstimateG: input.proteinEstimateG,
      resistanceSessions: input.resistanceSessions,
    };
    const patient = addCheckIn(input.phoneNumber, checkin);
    const risk = computeRiskScore(patient);
    updatePatient(input.phoneNumber, { dropoutRisk: risk });
    return {
      logged: true,
      dropoutRisk: risk,
      checkinCount: patient.checkins.length,
    };
  },
});
