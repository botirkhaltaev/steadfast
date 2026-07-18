import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient } from "#lib/store";

/**
 * Queue WhatsApp quick-reply buttons on the next outbound coach message.
 * Max 3 buttons (WhatsApp limit).
 */
export default defineTool({
  description:
    "Attach up to 3 WhatsApp quick-reply buttons to your NEXT text reply. Call this in the same turn before you finish speaking for onboarding taps (medication, dose, week, diet, protein, check-in frequency, side effects, motivation) and simple coaching forks (yes/no). Do not dump long option lists in text if buttons cover them.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    choices: z
      .array(
        z.object({
          label: z.string().max(20).describe("Button label shown on WhatsApp"),
          id: z
            .string()
            .max(200)
            .describe("Stable id when tapped, e.g. diet_vegetarian"),
        }),
      )
      .min(1)
      .max(3),
  }),
  async execute({ phoneNumber, choices }) {
    // Ensures durable patient session exists for this phone.
    getPatient(phoneNumber);
    const buttons = choices.map((c) => ({
      type: "quick_reply" as const,
      text: c.label.slice(0, 20),
      quickReplyId: c.id.slice(0, 200),
    }));
    return {
      queued: true,
      buttonCount: buttons.length,
      buttons,
      note: "Buttons attach to your next WhatsApp message this turn.",
    };
  },
});
