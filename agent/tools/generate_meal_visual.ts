import { defineTool } from "eve/tools";
import { z } from "zod";
import { generateMealUpgradeImage } from "#lib/runware";
import { getPatient } from "#lib/store";

export default defineTool({
  description:
    "Generate a personalized higher-protein meal visual via Runware. The image attaches to your next WhatsApp reply. Requires onboarding protein target + RUNWARE_API_KEY.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    mealDescription: z.string(),
    currentProteinG: z.number(),
  }),
  async execute({ phoneNumber, mealDescription, currentProteinG }) {
    const patient = getPatient(phoneNumber);
    if (patient.proteinTargetG == null) {
      throw new Error(
        "Protein target not set — finish onboarding before generating meal visuals",
      );
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
      note: "Image attaches to your next WhatsApp message this turn.",
    };
  },
});
