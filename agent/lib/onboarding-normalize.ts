/**
 * Normalize WhatsApp quick-reply ids / casual labels into durable profile fields.
 * Keeps onboarding resilient when the model passes button ids through literally.
 */

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
