import { defineTool } from "eve/tools";
import { z } from "zod";
import { generateMealUpgradeImage } from "#lib/runware";
import { requireOnboarded } from "#lib/store";

/** Default daily protein target when the patient did not set one during onboarding. */
const DEFAULT_PROTEIN_TARGET_G = 90;

export default defineTool({
  description:
    "Optional lifestyle tool: generate a personalized higher-protein meal visual via Runware. Image attaches to the WhatsApp reply for this turn. Requires completed onboarding + RUNWARE_API_KEY.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    mealDescription: z.string(),
    currentProteinG: z.number(),
  }),
  async execute({ phoneNumber, mealDescription, currentProteinG }) {
    const patient = requireOnboarded(phoneNumber);
    const proteinTargetG = patient.proteinTargetG ?? DEFAULT_PROTEIN_TARGET_G;

    const url = await generateMealUpgradeImage({
      mealDescription,
      proteinTargetG,
      currentProteinG,
      diet: patient.diet,
    });

    return {
      imageUrl: url,
      caption: `Here's your plate upgraded toward ~${proteinTargetG}g protein.`,
      generated: true,
      note: "Image attaches to your WhatsApp message for this turn.",
    };
  },
});
