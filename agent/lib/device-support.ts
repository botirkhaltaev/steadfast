import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GoogleGenAI, Modality } from "@google/genai";
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

type RegistryEntry = {
  claims: LinkTokenClaims;
  status: DeviceSupportStatus;
  summary: string | null;
  createdAt: number;
};

/** Best-effort single-use registry (process memory). Survives warm Vercel instances. */
const registry = new Map<string, RegistryEntry>();

function cleanupRegistry(now = Date.now()) {
  for (const [id, entry] of registry) {
    if (entry.claims.exp * 1000 < now - 60 * 60 * 1000) {
      registry.delete(id);
    }
  }
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

export function mintLinkToken(input: {
  phoneNumber: string;
  conversationId: string;
  name?: string | null;
  reason?: string | null;
  ttlMs?: number;
}): { token: string; claims: LinkTokenClaims; url: string } {
  cleanupRegistry();
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

  registry.set(claims.sid, {
    claims,
    status: "link_sent",
    summary: null,
    createdAt: Date.now(),
  });

  const url = `${publicBaseUrl()}/device-support?t=${encodeURIComponent(token)}`;
  return { token, claims, url };
}

export type VerifyLinkResult =
  | { ok: true; claims: LinkTokenClaims; entry: RegistryEntry }
  | { ok: false; error: string; status: number };

export function verifyLinkToken(raw: string): VerifyLinkResult {
  cleanupRegistry();
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

  let entry = registry.get(claims.sid);
  if (!entry) {
    // Cold start / new instance — reconstruct a link_sent entry from the signed claims.
    entry = {
      claims,
      status: "link_sent",
      summary: null,
      createdAt: Date.now(),
    };
    registry.set(claims.sid, entry);
  }

  return { ok: true, claims, entry };
}

export function markLinkStarted(sid: string): VerifyLinkResult {
  const entry = registry.get(sid);
  if (!entry) return { ok: false, error: "unknown_session", status: 404 };
  if (entry.claims.exp * 1000 < Date.now()) {
    return { ok: false, error: "expired", status: 410 };
  }
  if (entry.status !== "link_sent") {
    return { ok: false, error: "already_used", status: 409 };
  }
  entry.status = "started";
  return { ok: true, claims: entry.claims, entry };
}

export function markLinkOutcome(
  sid: string,
  outcome: DeviceSupportOutcome,
  summary: string | null,
): VerifyLinkResult {
  const entry = registry.get(sid);
  if (!entry) return { ok: false, error: "unknown_session", status: 404 };
  if (entry.status === "completed" || entry.status === "abandoned" || entry.status === "escalate") {
    // Idempotent: allow repeat outcome posts with same terminal status.
    return { ok: true, claims: entry.claims, entry };
  }
  entry.status = outcome;
  entry.summary = summary;
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
          sessionResumption: {},
          temperature: 0.7,
        },
      },
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
