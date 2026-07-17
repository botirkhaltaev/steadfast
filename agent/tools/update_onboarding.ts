import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  getPatient,
  missingOnboardingFields,
  updatePatient,
} from "#lib/store";

export default defineTool({
  description:
    "Save onboarding answers from WhatsApp (name, medication, dose, week, diet, protein target, motivation). Call after each answer or batch when several arrive. Marks onboarding complete when all required fields are present.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    conversationId: z.string().optional(),
    name: z.string().min(1).optional(),
    medication: z
      .string()
      .optional()
      .describe("e.g. semaglutide, tirzepatide, oral Wegovy, orforglipron"),
    dose: z.string().optional().describe("e.g. 0.25mg, 1mg, 12.5mg"),
    week: z.number().int().min(0).max(104).optional(),
    diet: z
      .string()
      .optional()
      .describe("e.g. omnivore, vegetarian, vegan, other"),
    proteinTargetG: z
      .number()
      .int()
      .min(40)
      .max(250)
      .optional()
      .describe("Daily protein target in grams"),
    motivation: z.string().optional(),
    sideEffectNote: z.string().optional(),
  }),
  async execute(input) {
    const patch: Parameters<typeof updatePatient>[1] = {
      onboardingStatus: "in_progress",
    };
    if (input.conversationId) patch.conversationId = input.conversationId;
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.medication !== undefined) patch.medication = input.medication.trim();
    if (input.dose !== undefined) patch.dose = input.dose.trim();
    if (input.week !== undefined) patch.week = input.week;
    if (input.diet !== undefined) patch.diet = input.diet.trim();
    if (input.proteinTargetG !== undefined) patch.proteinTargetG = input.proteinTargetG;
    if (input.motivation !== undefined) patch.motivation = input.motivation.trim();

    let patient = updatePatient(input.phoneNumber, patch);

    if (input.sideEffectNote?.trim()) {
      patient = updatePatient(input.phoneNumber, {
        sideEffectHistory: [
          ...patient.sideEffectHistory,
          input.sideEffectNote.trim(),
        ],
      });
    }

    const missing = missingOnboardingFields(patient);
    if (missing.length === 0) {
      patient = updatePatient(input.phoneNumber, {
        onboardingStatus: "complete",
      });
    }

    return {
      onboardingStatus: patient.onboardingStatus,
      missingOnboardingFields: missing,
      profile: {
        name: patient.name,
        medication: patient.medication,
        dose: patient.dose,
        week: patient.week,
        diet: patient.diet,
        proteinTargetG: patient.proteinTargetG,
        motivation: patient.motivation,
      },
    };
  },
});
