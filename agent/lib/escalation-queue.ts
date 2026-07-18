import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizePhone } from "#lib/phone";
import type { DropoutRisk } from "#lib/store";

export type QueuedEscalation = {
  id: string;
  phoneNumber: string;
  conversationId: string;
  patientName: string;
  week: number | null;
  dose: string | null;
  risk: DropoutRisk;
  urgency: "routine" | "urgent" | "emergency";
  summary: string;
  transcriptSnippet: string;
  redFlag: string;
  status: "open" | "notified" | "resolved";
  createdAt: string;
  updatedAt: string;
};

type QueueFile = {
  escalations: QueuedEscalation[];
};

function queuePath(): string {
  if (process.env.VERCEL) {
    return "/tmp/scout-sage-escalations.json";
  }
  return join(process.cwd(), ".eve", "escalations.json");
}

function readQueue(): QueueFile {
  try {
    const raw = readFileSync(queuePath(), "utf8");
    const parsed = JSON.parse(raw) as QueueFile;
    if (!parsed || !Array.isArray(parsed.escalations)) {
      return { escalations: [] };
    }
    return parsed;
  } catch {
    return { escalations: [] };
  }
}

function writeQueue(queue: QueueFile): void {
  const path = queuePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
}

function now() {
  return new Date().toISOString();
}

export function upsertEscalation(
  input: Omit<QueuedEscalation, "createdAt" | "updatedAt" | "status"> & {
    status?: QueuedEscalation["status"];
  },
): QueuedEscalation {
  const queue = readQueue();
  const ts = now();
  const phoneNumber = normalizePhone(input.phoneNumber);
  const existingIdx = queue.escalations.findIndex((e) => e.id === input.id);

  const card: QueuedEscalation = {
    ...input,
    phoneNumber,
    status: input.status ?? "open",
    createdAt:
      existingIdx >= 0 ? queue.escalations[existingIdx]!.createdAt : ts,
    updatedAt: ts,
  };

  if (existingIdx >= 0) {
    queue.escalations[existingIdx] = card;
  } else {
    queue.escalations.unshift(card);
  }

  // Cap history for demo file store.
  queue.escalations = queue.escalations.slice(0, 200);
  writeQueue(queue);
  return card;
}

export function listEscalations(): QueuedEscalation[] {
  const { escalations } = readQueue();
  return [...escalations].sort((a, b) => {
    const openRank = (s: QueuedEscalation["status"]) =>
      s === "resolved" ? 1 : 0;
    const byOpen = openRank(a.status) - openRank(b.status);
    if (byOpen !== 0) return byOpen;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function getEscalation(id: string): QueuedEscalation | null {
  return readQueue().escalations.find((e) => e.id === id) ?? null;
}

export function openHandoffForPhone(phoneNumber: string): QueuedEscalation | null {
  const phone = normalizePhone(phoneNumber);
  return (
    listEscalations().find(
      (e) =>
        e.phoneNumber === phone &&
        (e.status === "open" || e.status === "notified"),
    ) ?? null
  );
}

export function phoneHasHumanHandoff(phoneNumber: string): boolean {
  return Boolean(openHandoffForPhone(phoneNumber));
}

export function markQueuedNotified(id: string): QueuedEscalation | null {
  const card = getEscalation(id);
  if (!card || card.status === "resolved") return card;
  return upsertEscalation({ ...card, status: "notified" });
}

export function resolveEscalation(id: string): QueuedEscalation | null {
  const card = getEscalation(id);
  if (!card) return null;
  return upsertEscalation({ ...card, status: "resolved" });
}
