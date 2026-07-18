/** Normalize WhatsApp numbers to a stable E.164-ish key. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Keep leading +, strip other non-digits.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  return hasPlus || digits.length > 10 ? `+${digits}` : digits;
}
