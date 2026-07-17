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

function buildBody(payload: WassistOutbound) {
  if (payload.buttons?.length || payload.imageUrl) {
    return {
      type: "unified",
      unified: {
        text: payload.content,
        ...(payload.imageUrl
          ? { media: { url: payload.imageUrl } }
          : {}),
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
  return { type: "message", content: payload.content };
}

/**
 * Deliver via reply_callback (valid ~24h from user's last message).
 */
export async function sendViaCallback(
  replyCallback: string,
  payload: WassistOutbound,
): Promise<void> {
  const res = await fetch(replyCallback, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody(payload)),
  });

  if (!res.ok) {
    // Fallback: plain content if unified shape is rejected by sandbox.
    if (payload.buttons?.length || payload.imageUrl) {
      const fallback = await fetch(replyCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: payload.content,
          ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
        }),
      });
      if (fallback.ok) return;
      const text = await fallback.text().catch(() => "");
      throw new Error(`Wassist callback failed (${fallback.status}): ${text}`);
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Wassist callback failed (${res.status}): ${text}`);
  }
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
      ? {
          type: "unified",
          unified: {
            text: opts.content,
            ...(opts.imageUrl ? { media: { url: opts.imageUrl } } : {}),
            ...(opts.buttons?.length
              ? {
                  buttons: opts.buttons.slice(0, 3).map((b) => ({
                    type: "quick_reply" as const,
                    text: b.text.slice(0, 20),
                    quickReplyId: b.quickReplyId.slice(0, 200),
                  })),
                }
              : {}),
          },
        }
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
  const json = (await res.json()) as WassistConversation[] | { results?: WassistConversation[] };
  return Array.isArray(json) ? json : (json.results ?? []);
}
