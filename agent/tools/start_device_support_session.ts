import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  LINK_TTL_MS,
  MAX_LINKS_PER_DAY,
  mintLinkToken,
} from "#lib/device-support";
import {
  countRecentDeviceSupportLinks,
  createDeviceSupportSession,
  getPatient,
} from "#lib/store";

/**
 * Mint a one-time browser link for Gemini Live Tasso+ voice+vision support.
 * Scout includes the URL in its normal WhatsApp reply (plain text; WhatsApp auto-links).
 */
export default defineTool({
  description:
    "Create a one-time browser link for live Tasso+ device help (Gemini Live voice + camera). Use when the patient needs hands-on help with their Tasso/Tasso+ blood collection kit. Returns a URL to include in your WhatsApp reply. Do not use for medical red flags — those follow Safety rules.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    reason: z
      .string()
      .max(280)
      .optional()
      .describe("Short note on what they are struggling with"),
  }),
  async execute({ phoneNumber, reason }) {
    const patient = getPatient(phoneNumber);

    if (!patient.conversationId) {
      return {
        ok: false as const,
        reason: "missing_conversation_id",
        message:
          "No WhatsApp conversationId on the patient yet — ask them to reply once more, then retry.",
      };
    }

    const recent = countRecentDeviceSupportLinks(phoneNumber);
    if (recent >= MAX_LINKS_PER_DAY) {
      return {
        ok: false as const,
        reason: "daily_limit",
        message: `Patient already received ${recent} device-support links in 24h (max ${MAX_LINKS_PER_DAY}). Offer text tips or Tasso phone support 1-800-257-2370.`,
      };
    }

    try {
      const { url, claims } = mintLinkToken({
        phoneNumber: patient.phoneNumber,
        conversationId: patient.conversationId,
        name: patient.name,
        reason,
        ttlMs: LINK_TTL_MS,
      });

      createDeviceSupportSession(patient.phoneNumber, {
        id: claims.sid,
        reason,
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      });

      return {
        ok: true as const,
        url,
        sessionId: claims.sid,
        expiresInMinutes: Math.round(LINK_TTL_MS / 60000),
        note: "Include this URL in your WhatsApp reply. Tell them to open it on their phone, allow camera and mic, and stay seated with the kit ready.",
      };
    } catch (err) {
      return {
        ok: false as const,
        reason: "mint_failed",
        message: err instanceof Error ? err.message : "Could not create link",
      };
    }
  },
});
