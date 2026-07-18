import "#lib/env-bootstrap";
import { createHmac, timingSafeEqual } from "node:crypto";

export type WassistWebhookPayload = {
  message?: string | null;
  image?: string | null;
  phone_number: string;
  reply_callback?: string | null;
  conversation_id?: string | null;
};

export type QuickReplyButton = {
  type: "quick_reply";
  text: string;
  quickReplyId: string;
};

export type WassistOutbound = {
  content: string;
  imageUrl?: string;
  buttons?: QuickReplyButton[];
};

function buildUnified(payload: WassistOutbound) {
  return {
    type: "unified" as const,
    unified: {
      text: payload.content,
      ...(payload.imageUrl ? { media: { url: payload.imageUrl } } : {}),
      ...(payload.buttons?.length
        ? {
            buttons: payload.buttons.slice(0, 3).map((b) => ({
              type: "quick_reply" as const,
              text: b.text.slice(0, 20),
              quickReplyId: b.quickReplyId.slice(0, 200),
            })),
          }
        : {}),
    },
  };
}

function buildLegacy(payload: WassistOutbound) {
  return {
    type: "message" as const,
    content: payload.content,
    ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
    // Some BYOA sandboxes accept buttons at the top level.
    ...(payload.buttons?.length ? { buttons: payload.buttons.slice(0, 3) } : {}),
  };
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Deliver via reply_callback (valid within the WhatsApp 24h window).
 * Prefer simple `{ content }` (BYOA docs), then unified rich content, then legacy.
 * Buttons/images require unified or legacy.
 */
export async function sendViaCallback(
  replyCallback: string,
  payload: WassistOutbound,
): Promise<void> {
  const hasRich = Boolean(payload.buttons?.length || payload.imageUrl);

  if (!hasRich) {
    const simple = await postJson(replyCallback, { content: payload.content });
    if (simple.ok) return;
  }

  const primary = await postJson(replyCallback, buildUnified(payload));
  if (primary.ok) return;

  const fallback = await postJson(replyCallback, buildLegacy(payload));
  if (fallback.ok) return;

  const text = await fallback.text().catch(() => "");
  throw new Error(
    `Wassist callback failed (unified ${primary.status}, legacy ${fallback.status}): ${text}`,
  );
}

export async function sendViaRest(opts: {
  conversationId: string;
  content: string;
  imageUrl?: string;
  buttons?: QuickReplyButton[];
}): Promise<void> {
  const apiKey = process.env.WASSIST_API_KEY;
  if (!apiKey) {
    throw new Error("WASSIST_API_KEY is not set");
  }

  const base = process.env.WASSIST_API_BASE ?? "https://backend.wassist.app/api/v1";
  const body =
    opts.buttons?.length || opts.imageUrl
      ? buildUnified({
          content: opts.content,
          imageUrl: opts.imageUrl,
          buttons: opts.buttons,
        })
      : { type: "text", text: { body: opts.content } };

  const res = await fetch(`${base}/conversations/${opts.conversationId}/messages/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wassist REST send failed (${res.status}): ${text}`);
  }
}

export type WassistConversation = {
  id: string;
  number?: string;
  phone_number?: string;
  status?: string;
};

export async function listConversations(): Promise<WassistConversation[]> {
  const apiKey = process.env.WASSIST_API_KEY;
  if (!apiKey) return [];
  const base = process.env.WASSIST_API_BASE ?? "https://backend.wassist.app/api/v1";
  const res = await fetch(`${base}/conversations/`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wassist list conversations failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as
    | WassistConversation[]
    | { results?: WassistConversation[] };
  return Array.isArray(json) ? json : (json.results ?? []);
}

/**
 * Stripe-style HMAC verification for `x-wassist-signature: t=…,v1=…`.
 * Used by Wassist platform webhooks; BYOA may or may not sign yet.
 */
export function verifyWassistSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSec = 300,
): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [k, ...rest] = part.trim().split("=");
      return [k, rest.join("=")];
    }),
  ) as { t?: string; v1?: string };

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify inbound webhook auth when WASSIST_WEBHOOK_SECRET is set.
 *
 * Priority:
 * 1. `x-wassist-signature` → HMAC-SHA256 (platform webhooks)
 * 2. `x-wassist-secret` / `x-steadfast-webhook-secret` → exact match
 * 3. No recognizable auth headers → allow (Wassist BYOA currently posts
 *    without a shared-secret or signature header; rejecting those caused
 *    live WhatsApp 401s / "not authorized to respond")
 *
 * Note: do not treat `Authorization` as the webhook secret — Vercel/OIDC
 * and other proxies often populate it with unrelated tokens.
 */
export function verifyWebhookSecret(req: Request, rawBody = ""): boolean {
  const secret = process.env.WASSIST_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const signature = req.headers.get("x-wassist-signature");
  if (signature) {
    return verifyWassistSignature(rawBody, signature, secret);
  }

  const shared =
    req.headers.get("x-wassist-secret") ??
    req.headers.get("x-steadfast-webhook-secret");
  if (shared) {
    return shared === secret || shared === `Bearer ${secret}`;
  }

  // BYOA: no signature / custom secret headers on the wire yet.
  return true;
}
