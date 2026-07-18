import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizePhone } from "#lib/phone";

/**
 * Demo reset: bumping this epoch changes WhatsApp continuation tokens,
 * so the next message for every phone starts a fresh Eve session
 * (blank patient / eMed / briefs). Old sessions become unreachable.
 */

function epochFilePath(): string {
  // Vercel/serverless FS is mostly read-only; /tmp works for this instance.
  if (process.env.VERCEL) {
    return "/tmp/scout-sage-session-epoch";
  }
  return join(process.cwd(), ".eve", "session-epoch");
}

function envEpochFloor(): number {
  const raw = process.env.DEMO_SESSION_EPOCH?.trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function readStoredEpoch(): number {
  try {
    const raw = readFileSync(epochFilePath(), "utf8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStoredEpoch(epoch: number): void {
  const path = epochFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${epoch}\n`, "utf8");
}

/** Current session generation (max of file + env floor). */
export function getSessionEpoch(): number {
  return Math.max(readStoredEpoch(), envEpochFloor());
}

/** Bump epoch and persist. Returns the new value. */
export function bumpSessionEpoch(): number {
  const next = getSessionEpoch() + 1;
  writeStoredEpoch(next);
  return next;
}

/** Eve continuation token for a patient phone at the current epoch. */
export function patientContinuationToken(phoneNumber: string): string {
  const phone = normalizePhone(phoneNumber);
  return `scout-sage:e${getSessionEpoch()}:${phone}`;
}
