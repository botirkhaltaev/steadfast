type DeliveryOutcome = "delivered" | "failed";

type Waiter = {
  resolve: (outcome: DeliveryOutcome) => void;
  outcome: DeliveryOutcome | "pending";
};

/**
 * In-process latches so webhook waitUntil stays alive until the channel
 * actually flushes (or fails) — not merely until send() returns.
 *
 * Keyed per inbound webhook turn (phone + nonce). Channel event handlers
 * signal when flushOutbound finishes.
 */
const waiters = new Map<string, Waiter>();
/** Keys abandoned by the webhook timeout path — flush must not also send. */
const abandoned = new Set<string>();

export function createDeliveryKey(phoneNumber: string): string {
  return `${phoneNumber}:${crypto.randomUUID()}`;
}

/** Arm before send(); await the promise (raced with a timeout) after send(). */
export function armDeliveryWait(key: string): Promise<DeliveryOutcome> {
  abandoned.delete(key);
  const existing = waiters.get(key);
  if (existing && existing.outcome === "pending") {
    existing.outcome = "failed";
    existing.resolve("failed");
  }

  return new Promise<DeliveryOutcome>((resolve) => {
    waiters.set(key, { resolve, outcome: "pending" });
  });
}

export function signalDelivery(
  key: string | null | undefined,
  outcome: DeliveryOutcome,
): void {
  if (!key) return;
  const waiter = waiters.get(key);
  if (!waiter || waiter.outcome !== "pending") return;
  waiter.outcome = outcome;
  waiter.resolve(outcome);
  waiters.delete(key);
}

/**
 * Drop a pending waiter after a timeout.
 * Returns true only when this call won the race (still pending) — use that
 * gate before sending a timeout apology so a late flush cannot double-send.
 */
export function abandonDelivery(key: string | null | undefined): boolean {
  if (!key) return false;
  const waiter = waiters.get(key);
  if (!waiter || waiter.outcome !== "pending") return false;
  waiter.outcome = "failed";
  waiter.resolve("failed");
  waiters.delete(key);
  abandoned.add(key);
  return true;
}

export function wasDeliveryAbandoned(key: string | null | undefined): boolean {
  if (!key) return false;
  return abandoned.has(key);
}
