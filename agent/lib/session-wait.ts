type SessionLike = {
  getEventStream: (opts?: {
    startIndex?: number;
  }) => Promise<ReadableStream<unknown> | ReadableStream>;
};

const DEFAULT_TIMEOUT_MS = 50_000;

/**
 * Keep the serverless request alive until the Eve turn settles.
 * `send()` alone resolves too early for WhatsApp reply_callback delivery.
 */
export async function waitForTurnSettlement(
  session: SessionLike,
  opts?: { timeoutMs?: number },
): Promise<"settled" | "timeout"> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const settled = (async (): Promise<"settled"> => {
    const stream = await session.getEventStream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return "settled";

        buffer +=
          typeof value === "string"
            ? value
            : value instanceof Uint8Array
              ? decoder.decode(value, { stream: true })
              : String(value ?? "");

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as { type?: string };
            if (
              evt.type === "turn.completed" ||
              evt.type === "turn.failed" ||
              evt.type === "turn.cancelled" ||
              evt.type === "session.failed" ||
              evt.type === "session.waiting"
            ) {
              return "settled";
            }
          } catch {
            // ignore partial / non-JSON lines
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
  })();

  const timeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });

  return Promise.race([settled, timeout]);
}
