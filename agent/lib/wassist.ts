import "#lib/env-bootstrap";
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "#lib/phone";

/** Legacy BYOA webhook body. */
export type WassistWebhookPayload = {
  message?: string | null;
  image?: string | null;
  phone_number: string;
  reply_callback?: string | null;
  conversation_id?: string | null;
};

/** Normalized inbound after accepting BYOA or platform event envelopes. */
export type NormalizedInbound = {
  phoneNumber: string;
  text: string;
  imageUrl: string | null;
  replyCallback: string | null;
  conversationId: string | null;
  event: string | null;
  /** Lifecycle / ping / unknown events — ack without running the agent. */
  ignore: boolean;
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
  const hasRich = Boolean(opts.buttons?.length || opts.imageUrl);
  const bodies: unknown[] = hasRich
    ? [
        buildUnified({
          content: opts.content,
          imageUrl: opts.imageUrl,
          buttons: opts.buttons,
        }),
        { type: "text", text: { body: opts.content } },
      ]
    : [
        { type: "text", text: { body: opts.content } },
        buildUnified({ content: opts.content }),
      ];

  let lastStatus = 0;
  let lastText = "";
  for (const body of bodies) {
    const res = await fetch(
      `${base}/conversations/${opts.conversationId}/messages/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) return;
    lastStatus = res.status;
    lastText = await res.text().catch(() => "");
  }

  throw new Error(`Wassist REST send failed (${lastStatus}): ${lastText}`);
}

/**
 * Deliver a coach reply via BYOA reply_callback, or platform REST when only
 * conversationId is available (developer / subscription webhooks).
 */
export async function deliverOutbound(
  dest: { replyCallback?: string | null; conversationId?: string | null },
  payload: WassistOutbound,
): Promise<void> {
  if (dest.replyCallback) {
    await sendViaCallback(dest.replyCallback, payload);
    return;
  }
  if (dest.conversationId) {
    await sendViaRest({
      conversationId: dest.conversationId,
      content: payload.content,
      imageUrl: payload.imageUrl,
      buttons: payload.buttons,
    });
    return;
  }
  throw new Error("No reply_callback or conversationId for outbound delivery");
}

function extractMediaUrl(media: unknown[]): string | null {
  for (const item of media) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    for (const key of ["url", "imageUrl", "image", "link", "href"] as const) {
      const value = row[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        return value;
      }
    }
  }
  return null;
}

function buttonHint(buttons: unknown[]): string {
  const ids: string[] = [];
  for (const item of buttons) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id =
      (typeof row.quickReplyId === "string" && row.quickReplyId) ||
      (typeof row.id === "string" && row.id) ||
      (typeof row.payload === "string" && row.payload) ||
      "";
    if (id) ids.push(id);
  }
  return ids.length ? `[quick_reply=${ids.join(",")}]` : "";
}

/**
 * Accept both:
 * - BYOA: `{ phone_number, message, image?, reply_callback?, conversation_id? }`
 * - Platform: `{ event: "message.received", contact.phoneNumber, message.body, conversationId }`
 */
export function normalizeInboundWebhook(body: unknown): NormalizedInbound | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "invalid payload" };
  }
  const b = body as Record<string, unknown>;

  // Platform / developer webhook envelope
  if (typeof b.event === "string") {
    const event = b.event;
    const actionable =
      event === "message.received" || event === "subscription.message.received";
    if (!actionable) {
      return {
        phoneNumber: "",
        text: "",
        imageUrl: null,
        replyCallback: null,
        conversationId:
          typeof b.conversationId === "string" ? b.conversationId : null,
        event,
        ignore: true,
      };
    }

    const contact =
      b.contact && typeof b.contact === "object"
        ? (b.contact as Record<string, unknown>)
        : {};
    const message =
      b.message && typeof b.message === "object"
        ? (b.message as Record<string, unknown>)
        : {};

    // Customer phone — never use business `phoneNumber` / `whatsappNumber`.
    const rawPhone = String(contact.phoneNumber ?? b.from ?? "").trim();
    const phoneNumber = normalizePhone(rawPhone);
    if (!phoneNumber) {
      return { error: "phone_number required" };
    }

    const bodyText = typeof message.body === "string" ? message.body.trim() : "";
    const media = Array.isArray(message.media) ? message.media : [];
    const buttons = Array.isArray(message.buttons) ? message.buttons : [];
    const hint = buttonHint(buttons);
    const text = [bodyText, hint].filter(Boolean).join("\n");
    const imageUrl = extractMediaUrl(media);
    const conversationId =
      typeof b.conversationId === "string" ? b.conversationId : null;

    return {
      phoneNumber,
      text,
      imageUrl,
      replyCallback: null,
      conversationId,
      event,
      ignore: false,
    };
  }

  // BYOA shape
  const phoneNumber = normalizePhone(String(b.phone_number ?? "").trim());
  if (!phoneNumber) {
    return { error: "phone_number required" };
  }

  return {
    phoneNumber,
    text: typeof b.message === "string" ? b.message.trim() : "",
    imageUrl: typeof b.image === "string" ? b.image : null,
    replyCallback:
      typeof b.reply_callback === "string" ? b.reply_callback.trim() || null : null,
    conversationId:
      typeof b.conversation_id === "string" ? b.conversation_id : null,
    event: null,
    ignore: false,
  };
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
    // Docs compare hex-decoded digests; also accept raw hex string equality.
    if (/^[0-9a-f]+$/i.test(signature) && signature.length === expected.length) {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(signature, "hex");
      if (a.length === b.length && a.length > 0) {
        return timingSafeEqual(a, b);
      }
    }
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
