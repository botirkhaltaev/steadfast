import { defineState } from "eve/context";
import { normalizePhone } from "#lib/phone";

export type DropoutRisk = "low" | "medium" | "high";
export type OnboardingStatus = "not_started" | "in_progress" | "complete";
/** How often Steadfast proactively messages the patient. */
export type CheckInFrequency = "daily" | "every_few_days" | "weekly";

const CHECK_IN_INTERVAL_DAYS: Record<CheckInFrequency, number> = {
  daily: 1,
  every_few_days: 3,
  weekly: 7,
};

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
  checkInFrequency: CheckInFrequency | null;
  motivation: string | null;
  sideEffectHistory: string[];
  checkins: CheckIn[];
  dropoutRisk: DropoutRisk;
  escalations: EscalationCard[];
  conversationId?: string;
  /** ISO timestamp of last agent-initiated check-in. */
  lastProactiveCheckInAt?: string;
  /** WhatsApp message ids already coached on (newest last). */
  seenMessageIds?: string[];
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
    checkInFrequency: null,
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
  const notes = (latest?.notes ?? "").toLowerCase();
  const severity = latest?.sideEffectSeverity ?? 0;
  const score =
    (latest?.missedDoses && latest.missedDoses > 0 ? 2 : 0) +
    (severity >= 7 ? 2 : severity >= 4 ? 1 : 0) +
    (notes.includes("stop") ? 2 : 0) +
    (notes.includes("cost") ? 1 : 0) +
    (patient.week != null && patient.week >= 12 && patient.week <= 24 ? 1 : 0);

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
  if (!patient.checkInFrequency) missing.push("checkInFrequency");
  return missing;
}

/** Whether a proactive check-in should be sent now, based on chosen frequency. */
export function isProactiveCheckInDue(
  patient: Patient,
  at: Date = new Date(),
): boolean {
  if (patient.onboardingStatus !== "complete") return false;
  if (!patient.checkInFrequency || !patient.conversationId) return false;
  if (!patient.lastProactiveCheckInAt) return true;

  const lastMs = Date.parse(patient.lastProactiveCheckInAt);
  if (!Number.isFinite(lastMs)) return true;

  const elapsedDays = (at.getTime() - lastMs) / (24 * 60 * 60 * 1000);
  return elapsedDays >= CHECK_IN_INTERVAL_DAYS[patient.checkInFrequency];
}

export function markProactiveCheckInSent(phoneNumber: string): Patient {
  return updatePatient(phoneNumber, {
    lastProactiveCheckInAt: now(),
  });
}

/**
 * Record that this WhatsApp message is being handled.
 * Returns false if it was already seen (duplicate webhook / fan-out).
 */
export function rememberInboundMessage(
  phoneNumber: string,
  messageId: string,
): boolean {
  getPatient(phoneNumber);
  const result = { firstSeen: false };
  patientState.update((p) => {
    const seen = p.seenMessageIds ?? [];
    if (seen.includes(messageId)) {
      result.firstSeen = false;
      return p;
    }
    result.firstSeen = true;
    return {
      ...p,
      seenMessageIds: [...seen, messageId].slice(-50),
      updatedAt: now(),
    };
  });
  return result.firstSeen;
}
