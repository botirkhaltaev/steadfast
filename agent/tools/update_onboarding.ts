import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  normalizeCheckInFrequency,
  normalizeDiet,
  normalizeProteinTargetG,
} from "#lib/onboarding-normalize";
import {
  missingOnboardingFields,
  updatePatient,
} from "#lib/store";

export default defineTool({
  description:
    "Save onboarding answers from WhatsApp (name, medication, dose, week, diet, protein target, check-in frequency, motivation). Call after each answer or batch when several arrive. Accepts quick-reply ids like diet_vegetarian, protein_90, checkin_weekly. Marks onboarding complete when all required fields are present.",
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
      .describe("omnivore/vegetarian/vegan, or quick-reply id diet_vegetarian"),
    proteinTargetG: z
      .union([z.number().int().min(40).max(250), z.string().min(1)])
      .optional()
      .describe("Daily protein grams, or quick-reply id like protein_90 / ~105g"),
    checkInFrequency: z
      .string()
      .optional()
      .describe(
        "How often to proactively check in: daily | every_few_days | weekly, or ids checkin_daily / checkin_few_days / checkin_weekly",
      ),
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

    const diet = normalizeDiet(input.diet);
    if (diet !== undefined) patch.diet = diet;

    const proteinTargetG = normalizeProteinTargetG(input.proteinTargetG);
    if (proteinTargetG !== undefined) {
      if (proteinTargetG < 40 || proteinTargetG > 250) {
        throw new Error("proteinTargetG must be between 40 and 250");
      }
      patch.proteinTargetG = proteinTargetG;
    } else if (input.proteinTargetG !== undefined) {
      throw new Error(
        `Could not parse protein target from "${String(input.proteinTargetG)}" — use grams or protein_90-style id`,
      );
    }

    const checkInFrequency = normalizeCheckInFrequency(input.checkInFrequency);
    if (checkInFrequency !== undefined) {
      patch.checkInFrequency = checkInFrequency;
    } else if (input.checkInFrequency !== undefined) {
      throw new Error(
        `Could not parse check-in frequency from "${input.checkInFrequency}" — use daily, every_few_days, weekly, or checkin_* ids`,
      );
    }

    if (input.motivation !== undefined) patch.motivation = input.motivation.trim();

    const afterPatch = updatePatient(input.phoneNumber, patch);
    const sideEffectNote = input.sideEffectNote?.trim();
    const afterSideEffects = sideEffectNote
      ? updatePatient(input.phoneNumber, {
          sideEffectHistory: [...afterPatch.sideEffectHistory, sideEffectNote],
        })
      : afterPatch;

    const missing = missingOnboardingFields(afterSideEffects);
    const patient =
      missing.length === 0 && afterSideEffects.onboardingStatus !== "complete"
        ? updatePatient(input.phoneNumber, { onboardingStatus: "complete" })
        : afterSideEffects;

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
        checkInFrequency: patient.checkInFrequency,
        motivation: patient.motivation,
      },
    };
  },
});
