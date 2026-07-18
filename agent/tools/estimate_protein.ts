import { generateText } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOnboarded } from "#lib/store";

/** Default daily protein target when the patient did not set one during onboarding. */
const DEFAULT_PROTEIN_TARGET_G = 90;

export default defineTool({
  description:
    "Optional lifestyle tool: estimate protein (and fibre) grams from a meal photo URL using vision. Use when the patient sends a lunch/dinner image and nutrition support is helpful. Requires completed onboarding.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    imageUrl: z.string().url(),
    mealDescriptionHint: z.string().optional(),
  }),
  async execute({ phoneNumber, imageUrl, mealDescriptionHint }) {
    const patient = requireOnboarded(phoneNumber);
    const proteinTargetG = patient.proteinTargetG ?? DEFAULT_PROTEIN_TARGET_G;

    const dietNote = patient.diet ? `Diet: ${patient.diet}.` : "";
    const conditionNote = patient.condition
      ? `Patient programme/condition: ${patient.condition}.`
      : "";

    const { text } = await generateText({
      model: process.env.EVE_VISION_MODEL ?? "openai/gpt-5.4-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Estimate the protein and fibre content of this meal in grams.",
                dietNote,
                conditionNote,
                mealDescriptionHint ? `Hint: ${mealDescriptionHint}` : "",
                'Reply ONLY as JSON: {"proteinG":number,"fibreG":number,"description":string,"confidence":"low"|"medium"|"high"}',
              ]
                .filter(Boolean)
                .join(" "),
            },
            { type: "image", image: new URL(imageUrl) },
          ],
        },
      ],
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Vision model did not return JSON protein estimate");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      proteinG?: number;
      fibreG?: number;
      description?: string;
      confidence?: string;
    };

    const proteinG = Number(parsed.proteinG);
    if (!Number.isFinite(proteinG)) {
      throw new Error("Invalid proteinG from vision model");
    }

    return {
      proteinG,
      fibreG: Number(parsed.fibreG ?? 0),
      description: parsed.description ?? "meal from photo",
      confidence: parsed.confidence ?? "medium",
      proteinTargetG,
      gapG: Math.max(0, proteinTargetG - proteinG),
    };
  },
});
