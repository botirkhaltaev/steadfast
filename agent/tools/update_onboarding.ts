import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  normalizeCheckInFrequency,
  normalizeDiet,
  normalizeDose,
  normalizeMedication,
  normalizeMotivation,
  normalizeProteinTargetG,
  normalizeSideEffectNote,
  normalizeWeek,
} from "#lib/onboarding-normalize";
import {
  missingOnboardingFields,
  updatePatient,
} from "#lib/store";

export default defineTool({
  description:
    "Save onboarding answers from WhatsApp (name, medication, dose, week, diet, protein target, check-in frequency, motivation, side effects). Call after each answer or batch when several arrive. Accepts quick-reply ids: med_*, dose_*, week_*, diet_*, protein_*, checkin_*, side_*, mot_*. Marks onboarding complete when all required fields are present.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    conversationId: z.string().optional(),
    name: z.string().min(1).optional(),
    medication: z
      .string()
      .optional()
      .describe(
        "semaglutide / tirzepatide / oral GLP-1, or ids med_semaglutide / med_tirzepatide / med_oral",
      ),
    dose: z
      .string()
      .optional()
      .describe("e.g. 0.25mg, 2.5mg, or ids dose_0_25 / dose_2_5 / dose_14"),
    week: z
      .union([z.number().int().min(0).max(104), z.string().min(1)])
      .optional()
      .describe("Week number, or ids week_early / week_mid / week_later"),
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
    motivation: z
      .string()
      .optional()
      .describe("Free text or ids mot_health / mot_confidence / mot_energy"),
    sideEffectNote: z
      .string()
      .optional()
      .describe(
        "Free text or ids side_none / side_nausea / side_skip (skip records nothing)",
      ),
  }),
  async execute(input) {
    const patch: Parameters<typeof updatePatient>[1] = {
      onboardingStatus: "in_progress",
    };
    if (input.conversationId) patch.conversationId = input.conversationId;
    if (input.name !== undefined) patch.name = input.name.trim();

    const medication = normalizeMedication(input.medication);
    if (medication !== undefined) patch.medication = medication;

    const dose = normalizeDose(input.dose);
    if (dose !== undefined) patch.dose = dose;

    const week = normalizeWeek(input.week);
    if (week !== undefined) {
      if (week < 0 || week > 104) {
        throw new Error("week must be between 0 and 104");
      }
      patch.week = week;
    } else if (input.week !== undefined) {
      throw new Error(
        `Could not parse week from "${String(input.week)}" — use a number or week_early / week_mid / week_later`,
      );
    }

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

    const motivation = normalizeMotivation(input.motivation);
    if (motivation !== undefined) patch.motivation = motivation;

    const afterPatch = updatePatient(input.phoneNumber, patch);

    const sideEffect = normalizeSideEffectNote(input.sideEffectNote);
    const afterSideEffects =
      sideEffect && "note" in sideEffect
        ? updatePatient(input.phoneNumber, {
            sideEffectHistory: [...afterPatch.sideEffectHistory, sideEffect.note],
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
