import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient } from "#lib/store";
import { sendMessage } from "#lib/wassist";

/**
 * Proactive WhatsApp send (weekly check-ins) via the Conversations API.
 * Ordinary turn replies are flushed by the channel — do not use this for those.
 */
export default defineTool({
  description:
    "Send a proactive WhatsApp message via Wassist (weekly check-ins after onboarding). Requires conversationId on the patient profile. Do not use for ordinary replies — those go out automatically.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    content: z.string().min(1).max(1024),
  }),
  async execute({ phoneNumber, content }) {
    const patient = getPatient(phoneNumber);
    if (patient.onboardingStatus !== "complete") {
      return { sent: false, reason: "onboarding_incomplete" };
    }
    if (!patient.conversationId) {
      return { sent: false, reason: "missing_conversation_id" };
    }

    await sendMessage(patient.conversationId, { content });
    return { sent: true, conversationId: patient.conversationId };
  },
});
