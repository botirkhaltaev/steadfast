import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Draft a concise clinician escalation card from a patient transcript when red-flag symptoms appear. Does not message the patient.",
  model: process.env.EVE_MODEL ?? "openai/gpt-5.4-mini",
});
