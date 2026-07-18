import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient, markProactiveCheckInSent } from "#lib/store";
import { sendMessage } from "#lib/wassist";

/**
 * Proactive WhatsApp send via the Conversations API.
 * Ordinary turn replies are flushed by the channel — do not use this for those.
 */
export default defineTool({
  description:
    "Send a proactive WhatsApp check-in via Wassist after onboarding. Requires conversationId on the patient profile (or pass conversationId). Do not use for ordinary replies — those go out automatically.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    content: z.string().min(1).max(1024),
    conversationId: z
      .string()
      .optional()
      .describe("Override if the profile is missing conversationId"),
  }),
  async execute({ phoneNumber, content, conversationId }) {
    const patient = getPatient(phoneNumber);
    if (patient.onboardingStatus !== "complete") {
      return { sent: false, reason: "onboarding_incomplete" };
    }

    const dest = conversationId?.trim() || patient.conversationId;
    if (!dest) {
      return { sent: false, reason: "missing_conversation_id" };
    }

    await sendMessage(dest, { content });
    markProactiveCheckInSent(phoneNumber);

    return { sent: true, conversationId: dest };
  },
});
