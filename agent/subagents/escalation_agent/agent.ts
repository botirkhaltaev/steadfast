import { defineAgent } from "eve";

/**
 * Kept for optional clinician-card drafting in future demos.
 * The live WhatsApp path must call `escalate_to_clinician` on the root agent —
 * do not route patient red flags through this subagent.
 */
export default defineAgent({
  description:
    "Optional helper to draft a clinician escalation card. Prefer the root escalate_to_clinician tool for live WhatsApp red flags; this subagent must not message the patient.",
  model: process.env.EVE_MODEL ?? "openai/gpt-5.4-mini",
});
