export type DropoutRisk = "low" | "medium" | "high";

export type OnboardingStatus = "not_started" | "in_progress" | "complete";

export type CheckIn = {
  at: string;
  sideEffectSeverity?: number;
  missedDoses?: number;
  notes?: string;
  mood?: string;
  proteinEstimateG?: number;
  resistanceSessions?: number;
};

export type EscalationCard = {
  id: string;
  phoneNumber: string;
  patientName: string;
  week: number | null;
  dose: string | null;
  risk: DropoutRisk;
  urgency: "routine" | "urgent" | "emergency";
  summary: string;
  transcriptSnippet: string;
  redFlag: string;
  status: "open" | "notified";
  createdAt: string;
  updatedAt: string;
};

export type Patient = {
  phoneNumber: string;
  onboardingStatus: OnboardingStatus;
  name: string | null;
  week: number | null;
  dose: string | null;
  medication: string | null;
  diet: string | null;
  proteinTargetG: number | null;
  motivation: string | null;
  sideEffectHistory: string[];
  checkins: CheckIn[];
  dropoutRisk: DropoutRisk;
  escalations: string[];
  lastMealVisualUrl?: string;
  lastReplyCallback?: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
};

type Store = {
  patients: Record<string, Patient>;
  escalations: Record<string, EscalationCard>;
};

const globalKey = "__steadfast_store__";

function emptyStore(): Store {
  return { patients: {}, escalations: {} };
}

function getStore(): Store {
  const g = globalThis as typeof globalThis & { [globalKey]?: Store };
  if (!g[globalKey]) g[globalKey] = emptyStore();
  return g[globalKey];
}

function now() {
  return new Date().toISOString();
}

/** Get or create a blank patient record — no seeded persona. */
export function getPatient(phoneNumber: string): Patient {
  const store = getStore();
  const existing = store.patients[phoneNumber];
  if (existing) return existing;

  const created: Patient = {
    phoneNumber,
    onboardingStatus: "not_started",
    name: null,
    week: null,
    dose: null,
    medication: null,
    diet: null,
    proteinTargetG: null,
    motivation: null,
    sideEffectHistory: [],
    checkins: [],
    dropoutRisk: "low",
    escalations: [],
    createdAt: now(),
    updatedAt: now(),
  };
  store.patients[phoneNumber] = created;
  return created;
}

export function listPatients(): Patient[] {
  return Object.values(getStore().patients);
}

export function updatePatient(phoneNumber: string, patch: Partial<Patient>): Patient {
  const patient = getPatient(phoneNumber);
  Object.assign(patient, patch, { updatedAt: now() });
  return patient;
}

export function addCheckIn(phoneNumber: string, checkin: CheckIn): Patient {
  const patient = getPatient(phoneNumber);
  patient.checkins.push(checkin);
  patient.updatedAt = now();
  return patient;
}

export function createEscalation(
  input: Omit<EscalationCard, "id" | "createdAt" | "updatedAt" | "status">,
): EscalationCard {
  const store = getStore();
  const ts = now();
  const card: EscalationCard = {
    ...input,
    id: crypto.randomUUID(),
    status: "open",
    createdAt: ts,
    updatedAt: ts,
  };
  store.escalations[card.id] = card;
  getPatient(input.phoneNumber).escalations.push(card.id);
  return card;
}

export function listEscalations(): EscalationCard[] {
  return Object.values(getStore().escalations).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function getEscalation(id: string): EscalationCard | undefined {
  return getStore().escalations[id];
}

export function computeRiskScore(patient: Patient): DropoutRisk {
  const latest = patient.checkins[patient.checkins.length - 1];
  let score = 0;
  if (latest?.missedDoses && latest.missedDoses > 0) score += 2;
  if ((latest?.sideEffectSeverity ?? 0) >= 7) score += 2;
  else if ((latest?.sideEffectSeverity ?? 0) >= 4) score += 1;
  if ((latest?.notes ?? "").toLowerCase().includes("stop")) score += 2;
  if ((latest?.notes ?? "").toLowerCase().includes("cost")) score += 1;
  if (patient.week != null && patient.week >= 12 && patient.week <= 24) score += 1;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

/** Fields still needed before weekly coaching can start. */
export function missingOnboardingFields(patient: Patient): string[] {
  const missing: string[] = [];
  if (!patient.name) missing.push("name");
  if (!patient.medication) missing.push("medication");
  if (!patient.dose) missing.push("dose");
  if (patient.week == null) missing.push("week");
  if (!patient.diet) missing.push("diet");
  if (patient.proteinTargetG == null) missing.push("proteinTargetG");
  return missing;
}
