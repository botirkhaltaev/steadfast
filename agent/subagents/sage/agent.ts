import { defineAgent } from "eve";

/**
 * Sage — AI clinician partner for Scout.
 * Scout (root) messages the patient; Sage only returns briefs/guidance.
 */
export default defineAgent({
  description:
    "Sage, the AI clinician for Scout & Sage. Consult for clinical briefs, dropout/risk review, red-flag assessment, and coaching guidance. Never messages the patient — returns structured guidance for Scout to paraphrase.",
  model: process.env.EVE_MODEL ?? "openai/gpt-5.4-mini",
});
