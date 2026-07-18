import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient } from "#lib/store";
import { sendViaRest } from "#lib/wassist";

/**
 * Proactive WhatsApp send (weekly check-ins, follow-ups) via Wassist Conversations API.
 * Requires WASSIST_API_KEY + patient.conversationId from a prior inbound message.
 */
export default defineTool({
  description:
    "Send a proactive WhatsApp message to this patient via Wassist REST (for weekly check-ins after onboarding). Requires a known conversationId on the patient profile. Do not use for ordinary replies — those go out automatically.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    content: z.string().min(1).max(1024),
  }),
  async execute({ phoneNumber, content }) {
    const patient = getPatient(phoneNumber);
    if (patient.onboardingStatus !== "complete") {
      return {
        sent: false,
        reason: "onboarding_incomplete",
      };
    }
    if (!patient.conversationId) {
      return {
        sent: false,
        reason: "missing_conversation_id",
      };
    }

    await sendViaRest({
      conversationId: patient.conversationId,
      content,
    });

    return { sent: true, conversationId: patient.conversationId };
  },
});
