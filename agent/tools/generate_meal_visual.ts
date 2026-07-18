import { defineTool } from "eve/tools";
import { z } from "zod";
import { generateMealUpgradeImage } from "#lib/runware";
import { requireOnboarded } from "#lib/store";

export default defineTool({
  description:
    "Generate a personalized higher-protein meal visual via Runware. Image attaches to the WhatsApp reply for this turn. Requires completed onboarding + RUNWARE_API_KEY.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    mealDescription: z.string(),
    currentProteinG: z.number(),
  }),
  async execute({ phoneNumber, mealDescription, currentProteinG }) {
    const patient = requireOnboarded(phoneNumber);
    if (patient.proteinTargetG == null) {
      throw new Error("Protein target missing on onboarded profile");
    }

    const url = await generateMealUpgradeImage({
      mealDescription,
      proteinTargetG: patient.proteinTargetG,
      currentProteinG,
      diet: patient.diet,
    });

    return {
      imageUrl: url,
      caption: `Here's your plate upgraded toward ~${patient.proteinTargetG}g protein.`,
      generated: true,
      note: "Image attaches to your WhatsApp message for this turn.",
    };
  },
});
