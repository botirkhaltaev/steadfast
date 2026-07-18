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

export function normalizeMedication(
  raw: string | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function normalizeDose(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

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
  if (key === "side_nausea" || key === "mild nausea" || key === "nausea") {
    return { note: "mild nausea" };
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
