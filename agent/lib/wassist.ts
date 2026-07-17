export type WassistWebhookPayload = {
  message?: string | null;
  image?: string | null;
  phone_number: string;
  reply_callback?: string | null;
  conversation_id?: string | null;
};

export type WassistOutbound =
  | { type: "message"; content: string }
  | { type: "image"; content: string; url: string }
  | { content: string; imageUrl?: string };

/**
 * Fast-path webhook response (must return <5s). Prefer this when the reply is ready.
 */
export function webhookMessage(content: string) {
  return { type: "message" as const, content };
}

/**
 * Deliver via reply_callback when work took longer than the webhook window.
 * Wassist accepts flexible JSON; we send text and optional image URL.
 */
export async function sendViaCallback(
  replyCallback: string,
  payload: WassistOutbound,
): Promise<void> {
  const body =
    "imageUrl" in payload && payload.imageUrl
      ? { content: payload.content, image: payload.imageUrl }
      : "url" in payload && payload.type === "image"
        ? { content: payload.content, image: payload.url }
        : { content: "content" in payload ? payload.content : "" };

  const res = await fetch(replyCallback, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wassist callback failed (${res.status}): ${text}`);
  }
}

/**
 * Proactive / clinician-approved send via Conversations REST API.
 * Requires WASSIST_API_KEY and a conversation id.
 */
export async function sendViaRest(opts: {
  conversationId: string;
  content: string;
  imageUrl?: string;
}): Promise<void> {
  const apiKey = process.env.WASSIST_API_KEY;
  if (!apiKey) {
    throw new Error("WASSIST_API_KEY is not set");
  }

  const base = process.env.WASSIST_API_BASE ?? "https://backend.wassist.app/api/v1";
  const res = await fetch(
    `${base}/conversations/${opts.conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(
        opts.imageUrl
          ? { content: opts.content, image: opts.imageUrl }
          : { content: opts.content },
      ),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wassist REST send failed (${res.status}): ${text}`);
  }
}
