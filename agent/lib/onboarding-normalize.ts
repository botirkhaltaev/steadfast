/**
 * Normalize WhatsApp quick-reply ids / casual labels into durable profile fields.
 */

import type { CheckInFrequency, EmedSetupStatus } from "#lib/store";

const CONDITION_ALIASES: Record<string, string> = {
  cond_weight: "weight management",
  "weight management": "weight management",
  "weight mgmt": "weight management",
  cond_diabetes: "diabetes",
  diabetes: "diabetes",
  cond_heart: "heart health",
  "heart health": "heart health",
  cond_other: "other",
  other: "other",
};

export function normalizeCondition(
  raw: string | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return CONDITION_ALIASES[key] ?? raw.trim();
}

const DIET_ALIASES: Record<string, string> = {
  diet_omnivore: "omnivore",
  omnivore: "omnivore",
  diet_vegetarian: "vegetarian",
  vegetarian: "vegetarian",
  diet_vegan: "vegan",
  vegan: "vegan",
};

export function normalizeDiet(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return DIET_ALIASES[key] ?? raw.trim();
}

/** Accepts 90, "90", "protein_90", "~90g". */
export function normalizeProteinTargetG(
  raw: string | number | undefined,
): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw);
  }
  const text = String(raw).trim().toLowerCase();
  if (!text) return undefined;

  const idMatch = text.match(/^protein[_\s-]?(\d{2,3})$/);
  if (idMatch) return Number(idMatch[1]);

  const gramMatch = text.match(/(\d{2,3})\s*g\b/);
  if (gramMatch) return Number(gramMatch[1]);

  if (/^\d{2,3}$/.test(text)) return Number(text);

  return undefined;
}

const FREQUENCY_ALIASES: Record<string, CheckInFrequency> = {
  checkin_daily: "daily",
  daily: "daily",
  checkin_few_days: "every_few_days",
  every_few_days: "every_few_days",
  "every few days": "every_few_days",
  checkin_weekly: "weekly",
  weekly: "weekly",
};

export function normalizeCheckInFrequency(
  raw: string | undefined,
): CheckInFrequency | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return FREQUENCY_ALIASES[key];
}

const MEDICATION_ALIASES: Record<string, string> = {
  med_semaglutide: "semaglutide",
  semaglutide: "semaglutide",
  med_tirzepatide: "tirzepatide",
  tirzepatide: "tirzepatide",
  med_metformin: "metformin",
  metformin: "metformin",
  med_insulin: "insulin",
  insulin: "insulin",
  med_statin: "statin",
  statin: "statin",
  med_bp: "blood pressure medicine",
  "bp medicine": "blood pressure medicine",
  "blood pressure medicine": "blood pressure medicine",
  "blood pressure med": "blood pressure medicine",
};

/**
 * Maps medication quick-reply ids. `med_other` returns undefined so Scout asks for a typed name.
 */
export function normalizeMedication(
  raw: string | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (key === "med_other" || key === "other") return undefined;
  return MEDICATION_ALIASES[key] ?? raw.trim();
}

const DOSE_ALIASES: Record<string, string> = {
  dose_0_25: "0.25mg",
  "0.25mg": "0.25mg",
  dose_0_5: "0.5mg",
  "0.5mg": "0.5mg",
  dose_1: "1mg",
  "1mg": "1mg",
  dose_2_5: "2.5mg",
  "2.5mg": "2.5mg",
  dose_5: "5mg",
  "5mg": "5mg",
  dose_7_5: "7.5mg",
  "7.5mg": "7.5mg",
  dose_500: "500mg",
  "500mg": "500mg",
  dose_850: "850mg",
  "850mg": "850mg",
  dose_1000: "1000mg",
  "1000mg": "1000mg",
  dose_10u: "10 units",
  "10 units": "10 units",
  dose_20u: "20 units",
  "20 units": "20 units",
  dose_10: "10mg",
  "10mg": "10mg",
  dose_20: "20mg",
  "20mg": "20mg",
  dose_40: "40mg",
  "40mg": "40mg",
  dose_low: "low",
  low: "low",
  dose_medium: "medium",
  medium: "medium",
};

/**
 * Maps dose quick-reply ids. `dose_other` returns undefined so Scout asks for a typed dose.
 */
export function normalizeDose(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (key === "dose_other" || key === "other") return undefined;
  const compact = key.replace(/\s+/g, "");
  if (DOSE_ALIASES[key]) return DOSE_ALIASES[key];
  if (DOSE_ALIASES[compact]) return DOSE_ALIASES[compact];

  const mgMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*mg$/i);
  if (mgMatch) return `${mgMatch[1]}mg`;

  return trimmed;
}

const WEEK_ALIASES: Record<string, number> = {
  week_early: 2,
  "wk 1-4": 2,
  "wk 1–4": 2,
  week_mid: 8,
  "mo 2-3": 8,
  "mo 2–3": 8,
  week_later: 16,
  "mo 4+": 16,
};

export function normalizeWeek(
  raw: string | number | undefined,
): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw);
  }
  const text = String(raw).trim().toLowerCase();
  if (!text) return undefined;
  if (WEEK_ALIASES[text] !== undefined) return WEEK_ALIASES[text];
  if (/^\d{1,3}$/.test(text)) return Number(text);
  return undefined;
}

const MOTIVATION_ALIASES: Record<string, string> = {
  mot_health: "health",
  health: "health",
  mot_confidence: "confidence",
  confidence: "confidence",
  mot_energy: "energy",
  energy: "energy",
};

export function normalizeMotivation(
  raw: string | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return MOTIVATION_ALIASES[key] ?? raw.trim();
}

/**
 * Side-effect quick replies. `side_skip` means do not record a note.
 */
export function normalizeSideEffectNote(
  raw: string | undefined,
): { skip: true } | { note: string } | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (key === "side_skip" || key === "skip") return { skip: true };
  if (key === "side_none" || key === "none") return { note: "none" };
  if (
    key === "side_mild" ||
    key === "side_nausea" ||
    key === "mild side effects" ||
    key === "mild nausea" ||
    key === "nausea"
  ) {
    return { note: "mild side effects" };
  }
  return { note: raw.trim() };
}

const EMED_SETUP_ALIASES: Record<string, Exclude<EmedSetupStatus, "pending">> = {
  emed_connect: "linked",
  "connect emed": "linked",
  emed_no_device: "no_device",
  "i don't have one": "no_device",
  "i dont have one": "no_device",
  emed_skip: "skipped",
  "not now": "skipped",
};

export function normalizeEmedSetup(
  raw: string | undefined,
): Exclude<EmedSetupStatus, "pending"> | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return EMED_SETUP_ALIASES[key];
}
