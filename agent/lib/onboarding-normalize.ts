/**
 * Normalize WhatsApp quick-reply ids / casual labels into durable profile fields.
 * Keeps onboarding resilient when the model passes button ids through literally.
 */

import type { CheckInFrequency } from "#lib/store";

const DIET_ALIASES: Record<string, string> = {
  diet_omnivore: "omnivore",
  omnivore: "omnivore",
  "omnivore (meat + plants)": "omnivore",
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

/** Accepts 90, "90", "protein_90", "~90g", "About 105g". */
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
  "every day": "daily",
  "once a day": "daily",
  checkin_few_days: "every_few_days",
  every_few_days: "every_few_days",
  "every few days": "every_few_days",
  "few days": "every_few_days",
  checkin_weekly: "weekly",
  weekly: "weekly",
  "once a week": "weekly",
  "every week": "weekly",
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
  ozempic: "semaglutide",
  wegovy: "semaglutide",
  med_tirzepatide: "tirzepatide",
  tirzepatide: "tirzepatide",
  mounjaro: "tirzepatide",
  zepbound: "tirzepatide",
  med_oral: "oral GLP-1",
  "oral glp-1": "oral GLP-1",
  "oral glp1": "oral GLP-1",
  oral: "oral GLP-1",
  orforglipron: "oral GLP-1",
  "oral wegovy": "oral GLP-1",
};

export function normalizeMedication(
  raw: string | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  return MEDICATION_ALIASES[key] ?? raw.trim();
}

const DOSE_ALIASES: Record<string, string> = {
  dose_0_25: "0.25mg",
  "0.25mg": "0.25mg",
  "0.25": "0.25mg",
  dose_0_5: "0.5mg",
  "0.5mg": "0.5mg",
  "0.5": "0.5mg",
  dose_1: "1mg",
  "1mg": "1mg",
  "1.0mg": "1mg",
  dose_2_5: "2.5mg",
  "2.5mg": "2.5mg",
  "2.5": "2.5mg",
  dose_5: "5mg",
  "5mg": "5mg",
  dose_7_5: "7.5mg",
  "7.5mg": "7.5mg",
  "7.5": "7.5mg",
  dose_3: "3mg",
  "3mg": "3mg",
  dose_7: "7mg",
  "7mg": "7mg",
  dose_14: "14mg",
  "14mg": "14mg",
};

/** Maps dose button ids / labels; passes through other typed doses like 12.5mg. */
export function normalizeDose(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLowerCase().replace(/\s+/g, "");
  if (DOSE_ALIASES[key]) return DOSE_ALIASES[key];

  const mgMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*mg$/i);
  if (mgMatch) return `${mgMatch[1]}mg`;

  return trimmed;
}

const WEEK_ALIASES: Record<string, number> = {
  week_early: 2,
  "wk 1-4": 2,
  "wk 1–4": 2,
  "week 1-4": 2,
  "week 1–4": 2,
  week_mid: 8,
  "mo 2-3": 8,
  "mo 2–3": 8,
  "month 2-3": 8,
  "month 2–3": 8,
  week_later: 16,
  "mo 4+": 16,
  "month 4+": 16,
};

/** Accepts week_early / week_mid / week_later, labels, or plain integers. */
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
 * Returns `{ skip: true }` or `{ note }` or undefined if empty input.
 */
export function normalizeSideEffectNote(
  raw: string | undefined,
): { skip: true } | { note: string } | undefined {
  if (raw == null) return undefined;
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (key === "side_skip" || key === "skip") return { skip: true };
  if (key === "side_none" || key === "none") return { note: "none" };
  if (key === "side_nausea" || key === "mild nausea" || key === "nausea") {
    return { note: "mild nausea" };
  }
  return { note: raw.trim() };
}
