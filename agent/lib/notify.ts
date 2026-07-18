import type { EscalationCard } from "#lib/store";

/**
 * Future: notify humans about a clinical escalation.
 * Prefers CLINICIAN_WEBHOOK_URL (Slack/PagerDuty/custom); no-ops with a clear result if unset.
 * Unused by Scout/Sage live path today — human handoff is deferred.
 */
export async function notifyClinicians(card: EscalationCard): Promise<{
  notified: boolean;
  channel: "webhook" | "none";
  detail?: string;
}> {
  const webhook = process.env.CLINICIAN_WEBHOOK_URL;
  if (!webhook) {
    return {
      notified: false,
      channel: "none",
      detail:
        "CLINICIAN_WEBHOOK_URL not set — escalation stored in Neon inbox + patient record",
    };
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "scout_sage.escalation",
      urgency: card.urgency,
      redFlag: card.redFlag,
      patient: {
        name: card.patientName,
        phoneNumber: card.phoneNumber,
        week: card.week,
        dose: card.dose,
        risk: card.risk,
      },
      summary: card.summary,
      transcriptSnippet: card.transcriptSnippet,
      escalationId: card.id,
      createdAt: card.createdAt,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Clinician webhook failed (${res.status}): ${text}`);
  }

  return { notified: true, channel: "webhook" };
}
