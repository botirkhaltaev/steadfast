import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordDeviceSupportOutcome } from "#lib/store";

/**
 * Persist the Gemini Live Tasso+ session outcome onto the patient record.
 * Called when a [system] Device support session ended message arrives.
 */
export default defineTool({
  description:
    "Save the outcome of a Tasso+ Gemini Live device-support session. Call this FIRST when you receive a [system] Device support session ended message.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    sessionId: z.string(),
    outcome: z.enum(["completed", "abandoned", "escalate"]),
    summary: z.string().max(800).optional(),
  }),
  async execute({ phoneNumber, sessionId, outcome, summary }) {
    const updated = recordDeviceSupportOutcome(phoneNumber, {
      sessionId,
      status: outcome,
      summary: summary ?? null,
    });

    if (!updated) {
      return {
        saved: false,
        reason: "session_not_found",
        note: "No matching deviceSupportSession on the patient — continue the WhatsApp follow-up anyway.",
      };
    }

    return {
      saved: true,
      session: updated,
    };
  },
});
