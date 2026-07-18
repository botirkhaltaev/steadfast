import { eq } from "drizzle-orm";
import { getDb } from "#db/client";
import { appMeta } from "#db/schema";
import { normalizePhone } from "#lib/phone";

/**
 * Demo reset: bumping this epoch changes WhatsApp continuation tokens,
 * so the next message for every phone starts a fresh Eve session
 * (blank patient / eMed / briefs). Old sessions become unreachable.
 */

const EPOCH_KEY = "session_epoch";

function envEpochFloor(): number {
  const raw = process.env.DEMO_SESSION_EPOCH?.trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function readStoredEpoch(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, EPOCH_KEY))
    .limit(1);
  const raw = rows[0]?.value?.trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function writeStoredEpoch(epoch: number): Promise<void> {
  const db = getDb();
  const ts = new Date().toISOString();
  await db
    .insert(appMeta)
    .values({ key: EPOCH_KEY, value: String(epoch), updatedAt: ts })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: String(epoch), updatedAt: ts },
    });
}

/** Current session generation (max of Neon + env floor). */
export async function getSessionEpoch(): Promise<number> {
  return Math.max(await readStoredEpoch(), envEpochFloor());
}

/** Bump epoch and persist. Returns the new value. */
export async function bumpSessionEpoch(): Promise<number> {
  const next = (await getSessionEpoch()) + 1;
  await writeStoredEpoch(next);
  return next;
}

/** Eve continuation token for a patient phone at the current epoch. */
export async function patientContinuationToken(
  phoneNumber: string,
): Promise<string> {
  const phone = normalizePhone(phoneNumber);
  const epoch = await getSessionEpoch();
  return `scout-sage:e${epoch}:${phone}`;
}
