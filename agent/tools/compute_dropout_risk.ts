import { defineTool } from "eve/tools";
import { z } from "zod";
import { computeRiskScore, getPatient, updatePatient } from "#lib/store";

export default defineTool({
  description:
    "Recompute dropout risk (low/medium/high) from check-in signals after onboarding.",
  inputSchema: z.object({
    phoneNumber: z.string(),
  }),
  async execute({ phoneNumber }) {
    const patient = getPatient(phoneNumber);
    if (patient.onboardingStatus !== "complete") {
      throw new Error("Onboarding incomplete — finish onboarding first");
    }
    const risk = computeRiskScore(patient);
    updatePatient(phoneNumber, { dropoutRisk: risk });
    return {
      phoneNumber,
      name: patient.name,
      week: patient.week,
      dropoutRisk: risk,
      rationale:
        risk === "high"
          ? "Multiple churn signals — increase touchpoints and consider human coach outreach."
          : risk === "medium"
            ? "Some churn signals — stay close this week."
            : "Stable engagement — continue weekly ritual.",
    };
  },
});
