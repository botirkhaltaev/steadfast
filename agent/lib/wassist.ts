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
 * Tries unified rich content first, then legacy shape — buttons preserved in both.
 */
export async function sendViaCallback(
  replyCallback: string,
  payload: WassistOutbound,
): Promise<void> {
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
 * Verify inbound BYOA requests when WASSIST_WEBHOOK_SECRET is configured.
 * If unset, requests are allowed (hackathon/sandbox) — set the secret before real traffic.
 */
export function verifyWebhookSecret(req: Request): boolean {
  const secret = process.env.WASSIST_WEBHOOK_SECRET;
  if (!secret) return true;

  const header =
    req.headers.get("x-wassist-secret") ??
    req.headers.get("x-steadfast-webhook-secret") ??
    req.headers.get("authorization");

  if (!header) return false;
  if (header === secret) return true;
  if (header === `Bearer ${secret}`) return true;
  return false;
}
