import { generateText } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPatient } from "#lib/store";

export default defineTool({
  description:
    "Estimate protein (and fibre) grams from a meal photo URL using vision. Use when the patient sends a lunch/dinner image.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    imageUrl: z.string().url(),
    mealDescriptionHint: z.string().optional(),
  }),
  async execute({ phoneNumber, imageUrl, mealDescriptionHint }) {
    const patient = getPatient(phoneNumber);
    if (patient.proteinTargetG == null) {
      throw new Error(
        "Protein target not set — finish onboarding (proteinTargetG) before estimating meals",
      );
    }

    const dietNote = patient.diet ? `Diet: ${patient.diet}.` : "";

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
                "Patient is on a GLP-1 programme.",
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
      proteinTargetG: patient.proteinTargetG,
      gapG: Math.max(0, patient.proteinTargetG - proteinG),
    };
  },
});
