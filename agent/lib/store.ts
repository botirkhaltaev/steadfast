import { defineState } from "eve/context";

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
  escalations: EscalationCard[];
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
};

function now() {
  return new Date().toISOString();
}

function blankPatient(): Patient {
  const ts = now();
  return {
    phoneNumber: "",
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
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Durable per-WhatsApp-session patient record (Eve workflow state).
 * Sessions are keyed by phone via the Wassist channel continuation token.
 */
export const patientState = defineState("steadfast.patient", blankPatient);

export function getPatient(phoneNumber: string): Patient {
  const current = patientState.get();
  if (!current.phoneNumber) {
    patientState.update(() => ({
      ...blankPatient(),
      phoneNumber,
      createdAt: now(),
      updatedAt: now(),
    }));
    return patientState.get();
  }
  if (current.phoneNumber !== phoneNumber) {
    patientState.update(() => ({
      ...blankPatient(),
      phoneNumber,
      createdAt: now(),
      updatedAt: now(),
    }));
    return patientState.get();
  }
  return current;
}

export function updatePatient(phoneNumber: string, patch: Partial<Patient>): Patient {
  getPatient(phoneNumber);
  patientState.update((p) => ({
    ...p,
    ...patch,
    phoneNumber,
    updatedAt: now(),
  }));
  return patientState.get();
}

export function addCheckIn(phoneNumber: string, checkin: CheckIn): Patient {
  getPatient(phoneNumber);
  patientState.update((p) => ({
    ...p,
    checkins: [...p.checkins, checkin],
    updatedAt: now(),
  }));
  return patientState.get();
}

export function createEscalation(
  input: Omit<EscalationCard, "id" | "createdAt" | "updatedAt" | "status">,
): EscalationCard {
  const ts = now();
  const card: EscalationCard = {
    ...input,
    id: crypto.randomUUID(),
    status: "open",
    createdAt: ts,
    updatedAt: ts,
  };
  getPatient(input.phoneNumber);
  patientState.update((p) => ({
    ...p,
    escalations: [...p.escalations, card],
    updatedAt: ts,
  }));
  return card;
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
