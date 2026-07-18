import { isCurrentTurnBoundaryEvent } from "eve/client";

type SessionLike = {
  getEventStream: (opts?: {
    startIndex?: number;
  }) => Promise<ReadableStream<unknown> | ReadableStream>;
};

const DEFAULT_TIMEOUT_MS = 50_000;

type StreamEvent = {
  type?: string;
};

function asEvent(value: unknown): StreamEvent | null {
  if (value && typeof value === "object" && "type" in value) {
    return value as StreamEvent;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as StreamEvent;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Keep a schedule/receive waitUntil alive until the *current* turn parks.
 *
 * Important: getEventStream() yields parsed event objects (not raw NDJSON bytes),
 * and a resumed session may replay an old session.waiting. We therefore attach
 * near the tail (startIndex: -1) and only settle after a fresh turn.started
 * (or other in-turn activity) followed by a turn-boundary event.
 */
export async function waitForTurnSettlement(
  session: SessionLike,
  opts?: { timeoutMs?: number },
): Promise<"settled" | "timeout"> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const settled = (async (): Promise<"settled"> => {
    // -1 = latest event, then live tail. Avoids immediately matching a stale
    // session.waiting from a prior turn when replaying from index 0.
    const stream = await session.getEventStream({ startIndex: -1 });
    const reader = stream.getReader();
    const turn = { armed: false };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return "settled";

        const evt = asEvent(value);
        if (!evt?.type) continue;

        if (
          evt.type === "turn.started" ||
          evt.type === "message.received" ||
          evt.type === "step.started" ||
          evt.type === "actions.requested"
        ) {
          turn.armed = true;
        }

        if (!turn.armed) continue;

        if (
          isCurrentTurnBoundaryEvent(evt as never) ||
          evt.type === "turn.failed" ||
          evt.type === "turn.cancelled"
        ) {
          return "settled";
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
