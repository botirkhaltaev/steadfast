export type EscalationStatus = "open" | "notified" | "resolved";
export type Urgency = "routine" | "urgent" | "emergency";
export type DropoutRisk = "low" | "medium" | "high";

export type Escalation = {
  id: string;
  phoneNumber: string;
  conversationId: string;
  patientName: string;
  week: number | null;
  dose: string | null;
  risk: DropoutRisk;
  urgency: Urgency;
  summary: string;
  transcriptSnippet: string;
  redFlag: string;
  status: EscalationStatus;
  handoffStatus: "ai" | "human";
  createdAt: string;
  updatedAt: string;
};

export type ThreadMessage = {
  id?: string;
  role?: string;
  direction?: string;
  text: string;
  createdAt?: string;
  [key: string]: unknown;
};

/**
 * Same-origin clinician APIs under `/eve/v1/*` (withEve proxies that prefix).
 */
function apiBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.NEXT_PUBLIC_EVE_URL?.replace(/\/$/, "") ?? "";
}

const CLINICIAN_API = "/eve/v1/clinician";

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : typeof data.error === "string"
          ? data.error
          : res.statusText;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

export async function listEscalations(): Promise<Escalation[]> {
  const res = await fetch(`${apiBase()}${CLINICIAN_API}/escalations`, {
    cache: "no-store",
  });
  const data = await parseJson<{ escalations: Escalation[] }>(res);
  return data.escalations ?? [];
}

export async function getEscalation(id: string): Promise<Escalation> {
  const res = await fetch(
    `${apiBase()}${CLINICIAN_API}/escalations/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  const data = await parseJson<{ escalation: Escalation }>(res);
  return data.escalation;
}

export async function listEscalationMessages(
  id: string,
): Promise<ThreadMessage[]> {
  const res = await fetch(
    `${apiBase()}${CLINICIAN_API}/escalations/${encodeURIComponent(id)}/messages`,
    { cache: "no-store" },
  );
  const data = await parseJson<{ messages: ThreadMessage[] }>(res);
  return data.messages ?? [];
}

export async function sendEscalationMessage(
  id: string,
  text: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase()}${CLINICIAN_API}/escalations/${encodeURIComponent(id)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  await parseJson<{ ok: boolean }>(res);
}

export async function resolveEscalation(id: string): Promise<Escalation> {
  const res = await fetch(
    `${apiBase()}${CLINICIAN_API}/escalations/${encodeURIComponent(id)}/resolve`,
    { method: "POST" },
  );
  const data = await parseJson<{ escalation: Escalation }>(res);
  return data.escalation;
}
