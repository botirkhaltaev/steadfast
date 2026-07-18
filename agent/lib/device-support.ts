import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { GoogleGenAI, Modality } from "@google/genai";
import { getDb } from "#db/client";
import { deviceSupportLinks } from "#db/schema";
import { normalizePhone } from "#lib/phone";
import { buildTassoLiveSystemInstruction } from "#lib/tasso-live-prompt";
import type { DeviceSupportStatus } from "#lib/store";

/** How long a WhatsApp link stays valid. */
export const LINK_TTL_MS = 60 * 60 * 1000;
/** Max Tasso live links per patient per rolling 24h. */
export const MAX_LINKS_PER_DAY = 5;

export type DeviceSupportOutcome =
  | "completed"
  | "abandoned"
  | "escalate";

export type LinkTokenClaims = {
  /** Session / nonce id (also DeviceSupportSession.id). */
  sid: string;
  phone: string;
  conversationId: string;
  name: string | null;
  reason: string | null;
  exp: number;
};

export type RegistryEntry = {
  claims: LinkTokenClaims;
  status: DeviceSupportStatus;
  summary: string | null;
  createdAt: number;
};

function nowIso() {
  return new Date().toISOString();
}

async function cleanupExpiredLinks(now = Date.now()) {
  const cutoff = Math.floor((now - 60 * 60 * 1000) / 1000);
  const db = getDb();
  await db
    .delete(deviceSupportLinks)
    .where(lt(deviceSupportLinks.exp, cutoff));
}

function rowToEntry(
  row: typeof deviceSupportLinks.$inferSelect,
): RegistryEntry {
  return {
    claims: {
      sid: row.sid,
      phone: row.phoneNumber,
      conversationId: row.conversationId,
      name: row.patientName,
      reason: row.reason,
      exp: row.exp,
    },
    status: row.status as DeviceSupportStatus,
    summary: row.summary,
    createdAt: Date.parse(row.createdAt) || Date.now(),
  };
}

function linkSecret(): string {
  const secret =
    process.env.DEVICE_SUPPORT_LINK_SECRET?.trim() ||
    process.env.WASSIST_WEBHOOK_SECRET?.trim() ||
    process.env.GEMINI_API_KEY?.trim();
  if (!secret) {
    throw new Error(
      "DEVICE_SUPPORT_LINK_SECRET (or WASSIST_WEBHOOK_SECRET / GEMINI_API_KEY) is required",
    );
  }
  return secret;
}

export function publicBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const vercel = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) {
    return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  }
  return "http://localhost:3000";
}

export function geminiLiveModel(): string {
  return (
    process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.1-flash-live-preview"
  );
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(payloadB64: string): string {
  return b64url(createHmac("sha256", linkSecret()).update(payloadB64).digest());
}

export async function mintLinkToken(input: {
  phoneNumber: string;
  conversationId: string;
  name?: string | null;
  reason?: string | null;
  ttlMs?: number;
}): Promise<{ token: string; claims: LinkTokenClaims; url: string }> {
  await cleanupExpiredLinks();
  const phone = normalizePhone(input.phoneNumber);
  if (!phone) throw new Error("phoneNumber is required");
  const conversationId = input.conversationId.trim();
  if (!conversationId) throw new Error("conversationId is required");

  const ttl = input.ttlMs ?? LINK_TTL_MS;
  const claims: LinkTokenClaims = {
    sid: randomBytes(16).toString("hex"),
    phone,
    conversationId,
    name: input.name?.trim() || null,
    reason: input.reason?.trim() || null,
    exp: Math.floor((Date.now() + ttl) / 1000),
  };

  const payloadB64 = b64url(JSON.stringify(claims));
  const token = `${payloadB64}.${sign(payloadB64)}`;
  const ts = nowIso();

  const db = getDb();
  await db.insert(deviceSupportLinks).values({
    sid: claims.sid,
    phoneNumber: phone,
    conversationId,
    patientName: claims.name,
    reason: claims.reason,
    exp: claims.exp,
    status: "link_sent",
    summary: null,
    createdAt: ts,
    updatedAt: ts,
  });

  const url = `${publicBaseUrl()}/eve/v1/device-support?t=${encodeURIComponent(token)}`;
  return { token, claims, url };
}

export type VerifyLinkResult =
  | { ok: true; claims: LinkTokenClaims; entry: RegistryEntry }
  | { ok: false; error: string; status: number };

export async function verifyLinkToken(raw: string): Promise<VerifyLinkResult> {
  await cleanupExpiredLinks();
  const token = raw.trim();
  if (!token || !token.includes(".")) {
    return { ok: false, error: "invalid_token", status: 400 };
  }
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) {
    return { ok: false, error: "invalid_token", status: 400 };
  }

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "invalid_signature", status: 401 };
  }

  let claims: LinkTokenClaims;
  try {
    claims = JSON.parse(fromB64url(payloadB64).toString("utf8")) as LinkTokenClaims;
  } catch {
    return { ok: false, error: "invalid_payload", status: 400 };
  }

  if (!claims.sid || !claims.phone || !claims.conversationId || !claims.exp) {
    return { ok: false, error: "invalid_claims", status: 400 };
  }

  if (claims.exp * 1000 < Date.now()) {
    return { ok: false, error: "expired", status: 410 };
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(deviceSupportLinks)
    .where(eq(deviceSupportLinks.sid, claims.sid))
    .limit(1);

  const row = rows[0];
  if (!row) {
    // Signed token alone is not enough — Neon is source of truth for mint + status.
    return { ok: false, error: "unknown_session", status: 404 };
  }

  return { ok: true, claims, entry: rowToEntry(row) };
}

export async function markLinkStarted(sid: string): Promise<VerifyLinkResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(deviceSupportLinks)
    .where(eq(deviceSupportLinks.sid, sid))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "unknown_session", status: 404 };
  if (row.exp * 1000 < Date.now()) {
    return { ok: false, error: "expired", status: 410 };
  }
  if (row.status !== "link_sent") {
    return { ok: false, error: "already_used", status: 409 };
  }

  const ts = nowIso();
  await db
    .update(deviceSupportLinks)
    .set({ status: "started", updatedAt: ts })
    .where(eq(deviceSupportLinks.sid, sid));

  return {
    ok: true,
    claims: {
      sid: row.sid,
      phone: row.phoneNumber,
      conversationId: row.conversationId,
      name: row.patientName,
      reason: row.reason,
      exp: row.exp,
    },
    entry: {
      claims: {
        sid: row.sid,
        phone: row.phoneNumber,
        conversationId: row.conversationId,
        name: row.patientName,
        reason: row.reason,
        exp: row.exp,
      },
      status: "started",
      summary: row.summary,
      createdAt: Date.parse(row.createdAt) || Date.now(),
    },
  };
}

/** Reset a started link back to link_sent (e.g. Gemini mint failure). */
export async function resetLinkToSent(sid: string): Promise<void> {
  const db = getDb();
  const ts = nowIso();
  await db
    .update(deviceSupportLinks)
    .set({ status: "link_sent", updatedAt: ts })
    .where(eq(deviceSupportLinks.sid, sid));
}

/** Demo wipe: delete every Gemini Live / Tasso link row. Returns how many were removed. */
export async function clearAllDeviceSupportLinks(): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(deviceSupportLinks)
    .returning({ sid: deviceSupportLinks.sid });
  return deleted.length;
}

export async function markLinkOutcome(
  sid: string,
  outcome: DeviceSupportOutcome,
  summary: string | null,
): Promise<VerifyLinkResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(deviceSupportLinks)
    .where(eq(deviceSupportLinks.sid, sid))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "unknown_session", status: 404 };

  if (
    row.status === "completed" ||
    row.status === "abandoned" ||
    row.status === "escalate"
  ) {
    return { ok: true, claims: rowToEntry(row).claims, entry: rowToEntry(row) };
  }

  const ts = nowIso();
  await db
    .update(deviceSupportLinks)
    .set({ status: outcome, summary, updatedAt: ts })
    .where(eq(deviceSupportLinks.sid, sid));

  const entry = rowToEntry({ ...row, status: outcome, summary, updatedAt: ts });
  return { ok: true, claims: entry.claims, entry };
}

export async function mintGeminiEphemeralToken(opts: {
  patientName?: string | null;
  reason?: string | null;
}): Promise<{ token: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = geminiLiveModel();
  const client = new GoogleGenAI({
    apiKey,
    apiVersion: "v1alpha",
  });

  const systemInstruction = buildTassoLiveSystemInstruction({
    patientName: opts.patientName,
    reason: opts.reason,
  });

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          outputAudioTranscription: {},
          // A/V sessions hit a ~2 min wall without compression.
          contextWindowCompression: {
            triggerTokens: "10000",
            slidingWindow: { targetTokens: "8000" },
          },
          sessionResumption: {},
          temperature: 0.7,
        },
      },
      // Only lock fields we set; leave the rest unlocked for client session setup.
      lockAdditionalFields: [],
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  const name = token.name;
  if (!name) {
    throw new Error("Gemini auth token missing name");
  }

  return { token: name, model };
}

export function buildDeviceSupportOutcomeMessage(opts: {
  phoneNumber: string;
  conversationId: string;
  sessionId: string;
  outcome: DeviceSupportOutcome;
  summary: string | null;
  reason: string | null;
}): string {
  const phone = normalizePhone(opts.phoneNumber);
  const summary =
    opts.summary?.trim() ||
    (opts.outcome === "completed"
      ? "Live Tasso+ session finished."
      : opts.outcome === "escalate"
        ? "Live Tasso+ session escalated."
        : "Live Tasso+ session ended without completing collection.");

  return [
    `[patient_phone=${phone}]`,
    `[conversation_id=${opts.conversationId}]`,
    "[system] Device support session ended.",
    `sessionId=${opts.sessionId}`,
    `outcome=${opts.outcome}`,
    opts.reason ? `reason=${opts.reason}` : null,
    `summary=${summary}`,
    "FIRST ACTION: call record_device_support_outcome with phoneNumber, sessionId, outcome, and summary.",
    "Then send one short WhatsApp follow-up:",
    "- completed: congratulate, remind same-day UPS shipping if they collected, offer further help.",
    "- abandoned: ask what blocked them; offer a fresh link if they still want live help.",
    "- escalate: stop device coaching; apply Safety rules; consult Sage if clinical/red-flag.",
    "Do not invent clinical findings from the summary.",
  ]
    .filter(Boolean)
    .join("\n");
}
