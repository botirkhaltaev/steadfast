import { defineState } from "eve/context";
import { normalizePhone } from "#lib/phone";

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
  /** Recent Wassist delivery/message ids — suppress double-processed turns. */
  recentInboundIds?: string[];
  /** Recent outbound content fingerprints — suppress duplicate WhatsApp sends. */
  recentOutboundFingerprints?: string[];
  createdAt: string;
  updatedAt: string;
};

function now() {
  return new Date().toISOString();
}

function blankPatient(phoneNumber = ""): Patient {
  const ts = now();
  return {
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
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Durable per-WhatsApp-session patient record (Eve workflow state).
 * Sessions are keyed by phone via the Wassist channel continuation token.
 */
export const patientState = defineState("steadfast.patient", () => blankPatient());

export function getPatient(phoneNumber: string): Patient {
  const phone = normalizePhone(phoneNumber);
  if (!phone) {
    throw new Error("phoneNumber is required");
  }

  const current = patientState.get();

  if (!current.phoneNumber) {
    patientState.update(() => blankPatient(phone));
    return patientState.get();
  }

  const currentPhone = normalizePhone(current.phoneNumber);
  if (currentPhone !== phone) {
    // Same Eve session must not silently wipe another patient's durable record.
    throw new Error(
      `Patient phone mismatch: session is ${currentPhone}, tool called with ${phone}`,
    );
  }

  // Canonicalize formatting if needed.
  if (current.phoneNumber !== phone) {
    patientState.update((p) => ({ ...p, phoneNumber: phone, updatedAt: now() }));
  }

  return patientState.get();
}

export function updatePatient(phoneNumber: string, patch: Partial<Patient>): Patient {
  getPatient(phoneNumber);
  const phone = normalizePhone(phoneNumber);
  patientState.update((p) => ({
    ...p,
    ...patch,
    phoneNumber: phone,
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
    phoneNumber: normalizePhone(input.phoneNumber),
    id: crypto.randomUUID(),
    status: "open",
    createdAt: ts,
    updatedAt: ts,
  };
  getPatient(card.phoneNumber);
  patientState.update((p) => ({
    ...p,
    escalations: [...p.escalations, card],
    updatedAt: ts,
  }));
  return card;
}

export function markEscalationNotified(phoneNumber: string, escalationId: string): void {
  getPatient(phoneNumber);
  patientState.update((p) => ({
    ...p,
    escalations: p.escalations.map((e) =>
      e.id === escalationId ? { ...e, status: "notified" as const, updatedAt: now() } : e,
    ),
    updatedAt: now(),
  }));
}

export function requireOnboarded(phoneNumber: string): Patient {
  const patient = getPatient(phoneNumber);
  if (patient.onboardingStatus !== "complete") {
    throw new Error("Onboarding incomplete — finish onboarding first");
  }
  return patient;
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

/** Claim an inbound delivery/message id. False = already processed. */
export function claimPatientInbound(
  phoneNumber: string,
  inboundId: string,
): boolean {
  getPatient(phoneNumber);
  let claimed = false;
  patientState.update((p) => {
    const recent = p.recentInboundIds ?? [];
    if (recent.includes(inboundId)) {
      claimed = false;
      return p;
    }
    claimed = true;
    return {
      ...p,
      recentInboundIds: [...recent, inboundId].slice(-40),
      updatedAt: now(),
    };
  });
  return claimed;
}

/** Claim an outbound fingerprint. False = identical text just sent. */
export function claimPatientOutbound(
  phoneNumber: string,
  fingerprint: string,
): boolean {
  getPatient(phoneNumber);
  let claimed = false;
  patientState.update((p) => {
    const recent = p.recentOutboundFingerprints ?? [];
    if (recent.includes(fingerprint)) {
      claimed = false;
      return p;
    }
    claimed = true;
    return {
      ...p,
      recentOutboundFingerprints: [...recent, fingerprint].slice(-40),
      updatedAt: now(),
    };
  });
  return claimed;
}
