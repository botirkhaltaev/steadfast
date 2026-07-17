type RunwareResult = {
  imageURL?: string;
  imageUrl?: string;
};

/**
 * Generate a personalized "upgraded meal" visual via Runware FLUX.
 */
export async function generateMealUpgradeImage(opts: {
  mealDescription: string;
  proteinTargetG: number;
  currentProteinG: number;
  diet?: string | null;
}): Promise<string> {
  const apiKey = process.env.RUNWARE_API_KEY;
  if (!apiKey) {
    throw new Error("RUNWARE_API_KEY is not set");
  }

  const dietLine = opts.diet
    ? `Respect a ${opts.diet} diet.`
    : "Keep the meal style consistent with the description.";

  const prompt = [
    "Photorealistic top-down photo of the same lunch plate,",
    `upgraded to hit about ${opts.proteinTargetG}g protein (was ~${opts.currentProteinG}g).`,
    `Meal context: ${opts.mealDescription}.`,
    dietLine,
    "Natural lighting, appetizing, no text overlay, no logos.",
  ].join(" ");

  const taskUUID = crypto.randomUUID();
  const res = await fetch(process.env.RUNWARE_API_URL ?? "https://api.runware.ai/v1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        taskType: "imageInference",
        taskUUID,
        model: process.env.RUNWARE_MODEL ?? "runware:400@1",
        positivePrompt: prompt,
        width: 1024,
        height: 1024,
        deliveryMethod: "sync",
        numberResults: 1,
      },
    ]),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Runware failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as
    | { data?: RunwareResult[] }
    | RunwareResult[]
    | { imageURL?: string };

  const rows = Array.isArray(json)
    ? json
    : "data" in json && Array.isArray(json.data)
      ? json.data
      : [json as RunwareResult];

  const url = rows[0]?.imageURL ?? rows[0]?.imageUrl;
  if (!url) {
    throw new Error("Runware response missing imageURL");
  }
  return url;
}
