import "#lib/env-bootstrap";
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "#lib/phone";

const API_BASE =
  process.env.WASSIST_API_BASE ?? "https://backend.wassist.app/api/v1";

export type QuickReplyButton = {
  type: "quick_reply";
  text: string;
  quickReplyId: string;
};

export type OutboundMessage = {
  content: string;
  imageUrl?: string;
  buttons?: QuickReplyButton[];
};

/** Parsed inbound WhatsApp message from a Wassist platform webhook. */
export type InboundMessage = {
  phoneNumber: string;
  conversationId: string;
  messageId: string;
  text: string;
  imageUrl: string | null;
  audioUrl: string | null;
  audioMimeType: string | null;
};

export type WassistConversation = {
  id: string;
  number?: string;
  phone_number?: string;
  status?: string;
};

type MediaItem = {
  url?: string;
  mimeType?: string;
};

type PlatformEvent = {
  event?: string;
  conversationId?: string;
  from?: string;
  contact?: { phoneNumber?: string | null; name?: string | null };
  message?: {
    id?: string;
    body?: string | null;
    media?: Array<MediaItem | null> | null;
    buttons?: unknown[] | null;
  } | null;
};

const IMAGE_PATH_RE = /\.(jpe?g|png|webp)(?:\?|#|$)/i;

/** Classify a media item as image, audio, or unknown (never treat audio as image). */
export function classifyMediaItem(
  item: MediaItem | null | undefined,
): "image" | "audio" | "unknown" {
  if (!item || typeof item.url !== "string" || !item.url.trim()) {
    return "unknown";
  }

  const mime = (item.mimeType ?? "").trim().toLowerCase();
  const primary = mime.split(";")[0]?.trim() ?? "";
  if (primary.startsWith("image/")) return "image";
  if (primary.startsWith("audio/")) return "audio";

  // Missing mimeType: only treat as image when the path looks image-like.
  if (!primary && IMAGE_PATH_RE.test(item.url)) return "image";
  return "unknown";
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function pickMedia(
  media: Array<MediaItem | null> | null | undefined,
): {
  imageUrl: string | null;
  audioUrl: string | null;
  audioMimeType: string | null;
} {
  let imageUrl: string | null = null;
  let audioUrl: string | null = null;
  let audioMimeType: string | null = null;

  for (const item of media ?? []) {
    if (!item || typeof item.url !== "string") continue;
    const url = item.url.trim();
    if (!url) continue;

    const kind = classifyMediaItem(item);
    if (kind === "image" && !imageUrl) {
      imageUrl = url;
    } else if (kind === "audio" && !audioUrl) {
      audioUrl = url;
      const mime = (item.mimeType ?? "").trim();
      audioMimeType = mime || null;
    }

    if (imageUrl && audioUrl) break;
  }

  return { imageUrl, audioUrl, audioMimeType };
}

/**
 * Verify `x-wassist-signature` (Stripe-style `t=,v1=` HMAC-SHA256).
 * @see https://docs.wassist.app/concepts/webhooks
 */
export function verifySignature(
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

  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Authenticate an inbound webhook.
 * When `WASSIST_WEBHOOK_SECRET` is set, `x-wassist-signature` is required.
 * When unset (local dev), requests are allowed.
 */
export function authenticateWebhook(req: Request, rawBody: string): boolean {
  const secret = process.env.WASSIST_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const signature = req.headers.get("x-wassist-signature");
  if (!signature) return false;
  return verifySignature(rawBody, signature, secret);
}

export type ParseResult =
  | { kind: "message"; message: InboundMessage }
  | { kind: "ignored"; event: string }
  | { kind: "error"; error: string };

/**
 * Parse a Wassist platform webhook body.
 * Only `message.received` becomes an agent turn.
 * `subscription.message.received` is ignored — Wassist often fans out both
 * for the same WhatsApp message, which would start duplicate Eve turns.
 */
export function parseWebhookBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { kind: "error", error: "invalid payload" };
  }

  const event = (body as PlatformEvent).event;
  if (typeof event !== "string") {
    return { kind: "error", error: "missing event" };
  }

  if (event !== "message.received") {
    return { kind: "ignored", event };
  }

  const payload = body as PlatformEvent;
  const contactPhone = payload.contact?.phoneNumber ?? payload.from ?? "";
  const phoneNumber = normalizePhone(contactPhone.trim());
  if (!phoneNumber) {
    return { kind: "error", error: "missing contact phone" };
  }

  const conversationId = payload.conversationId?.trim() ?? "";
  if (!conversationId) {
    return { kind: "error", error: "missing conversationId" };
  }

  const message = payload.message;
  if (!message || typeof message !== "object") {
    return { kind: "ignored", event };
  }

  const messageId = message.id?.trim() ?? "";
  if (!messageId) {
    return { kind: "error", error: "missing message id" };
  }

  const text = (message.body ?? "").trim();
  const { imageUrl, audioUrl, audioMimeType } = pickMedia(message.media);

  if (!text && !imageUrl && !audioUrl) {
    return { kind: "ignored", event };
  }

  for (const mediaUrl of [imageUrl, audioUrl]) {
    if (mediaUrl && !isHttpUrl(mediaUrl)) {
      return { kind: "error", error: "invalid media url" };
    }
  }

  return {
    kind: "message",
    message: {
      phoneNumber,
      conversationId,
      messageId,
      text,
      imageUrl,
      audioUrl,
      audioMimeType,
    },
  };
}

function unifiedBody(message: OutboundMessage) {
  return {
    type: "unified" as const,
    unified: {
      text: message.content,
      ...(message.imageUrl ? { media: { url: message.imageUrl } } : {}),
      ...(message.buttons?.length
        ? {
            buttons: message.buttons.slice(0, 3).map((b) => ({
              type: "quick_reply" as const,
              text: b.text.slice(0, 20),
              quickReplyId: b.quickReplyId.slice(0, 200),
            })),
          }
        : {}),
    },
  };
}

/** Send a WhatsApp message on an existing conversation. */
export async function sendMessage(
  conversationId: string,
  message: OutboundMessage,
): Promise<void> {
  const apiKey = process.env.WASSIST_API_KEY;
  if (!apiKey) {
    throw new Error("WASSIST_API_KEY is not set");
  }

  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(
      message.buttons?.length || message.imageUrl
        ? unifiedBody(message)
        : { type: "text", text: { body: message.content } },
    ),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wassist send failed (${res.status}): ${text}`);
  }
}

export async function listConversations(): Promise<WassistConversation[]> {
  const apiKey = process.env.WASSIST_API_KEY;
  if (!apiKey) return [];

  const res = await fetch(`${API_BASE}/conversations/`, {
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
