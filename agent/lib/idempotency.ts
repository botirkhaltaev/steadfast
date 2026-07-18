/**
 * Best-effort dedupe for Wassist double-deliveries and duplicate outbound texts.
 * Process-local (serverless isolates don't share memory) — still collapses
 * retries in the same isolate and exact duplicate flushes when they land together.
 */

const inboundSeen = new Map<string, number>();
const outboundSeen = new Map<string, number>();

const TTL_MS = 5 * 60 * 1000;

function prune(map: Map<string, number>, now: number) {
  for (const [key, at] of map) {
    if (now - at > TTL_MS) map.delete(key);
  }
}

/** Returns true if this is the first time we've seen the key (claim succeeded). */
export function claimInbound(key: string | null | undefined): boolean {
  if (!key) return true;
  const now = Date.now();
  prune(inboundSeen, now);
  if (inboundSeen.has(key)) return false;
  inboundSeen.set(key, now);
  return true;
}

/** Returns true if outbound content should be sent (not a recent duplicate). */
export function claimOutbound(key: string | null | undefined): boolean {
  if (!key) return true;
  const now = Date.now();
  prune(outboundSeen, now);
  if (outboundSeen.has(key)) return false;
  outboundSeen.set(key, now);
  return true;
}

export function outboundFingerprint(opts: {
  phoneNumber: string | null;
  conversationId: string | null;
  content: string;
}): string {
  const content = opts.content.trim().replace(/\s+/g, " ").slice(0, 500);
  return `${opts.phoneNumber ?? ""}|${opts.conversationId ?? ""}|${content}`;
}
