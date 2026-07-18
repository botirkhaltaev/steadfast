import type { SessionAuthContext } from "eve/context";
import wassist from "../channels/wassist";
import { normalizePhone } from "#lib/phone";
import { waitForTurnSettlement } from "#lib/session-wait";

type SessionLike = {
  getEventStream: (opts?: {
    startIndex?: number;
  }) => Promise<ReadableStream<unknown> | ReadableStream>;
};

type ReceiveFn = (
  channel: typeof wassist,
  options: {
    message: string;
    target: { phoneNumber: string };
    auth: SessionAuthContext | null;
  },
) => Promise<SessionLike>;

/** System prompt that resumes a patient session for an agent-initiated check-in. */
export function buildProactiveCheckInMessage(opts: {
  phoneNumber: string;
  conversationId: string;
  force?: boolean;
}): string {
  const phone = normalizePhone(opts.phoneNumber);
  const forceLine = opts.force
    ? "Force send even if proactiveCheckInDue is false (demo / manual trigger)."
    : "Only send if proactiveCheckInDue is true.";

  return [
    `[patient_phone=${phone}]`,
    `[conversation_id=${opts.conversationId}]`,
    "[system] Proactive check-in.",
    "Call get_patient_profile with this phone and conversationId.",
    "If onboarding is incomplete, do nothing (no patient message).",
    forceLine,
    "If you should message: call send_whatsapp_message with one short warm check-in.",
    "Use their name if known. Ask about side effects, doses, and how they feel.",
    "Match their checkInFrequency tone (daily = brief pulse; weekly = fuller check-in).",
    "If emedDeviceLinked, you may mention Sage can review their eMed monitor — do not invent vitals (Scout has no eMed reading tools).",
    "Then stop — do not coach further until they reply.",
  ].join("\n");
}

/**
 * Resume the patient's Eve session and ask the agent to send a proactive check-in
 * when onboarding is complete and a check-in is due (unless force is set).
 */
export async function runProactiveCheckIn(opts: {
  receive: ReceiveFn;
  auth: SessionAuthContext;
  phoneNumber: string;
  conversationId: string;
  force?: boolean;
}): Promise<void> {
  const phone = normalizePhone(opts.phoneNumber);

  const session = await opts.receive(wassist, {
    message: buildProactiveCheckInMessage({
      phoneNumber: phone,
      conversationId: opts.conversationId,
      force: opts.force,
    }),
    target: { phoneNumber: phone },
    auth: opts.auth,
  });

  await waitForTurnSettlement(session);
}
