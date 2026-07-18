import "#lib/env-bootstrap";
import { defineAgent } from "eve";

export default defineAgent({
  // OpenAI via AI Gateway (hackathon credits). Override with OPENAI_API_KEY + @ai-sdk/openai if needed.
  model: process.env.EVE_MODEL ?? "openai/gpt-5.4-mini",
});
