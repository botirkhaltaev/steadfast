import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveSageBrief } from "#lib/store";

export default defineTool({
  description:
    "Persist a Sage clinical brief on the patient record for Scout coordination. Call once per consult before finishing.",
  inputSchema: z.object({
    phoneNumber: z.string(),
    reason: z.enum([
      "red_flag",
      "dropout_risk",
      "side_effect",
      "adherence",
      "checkin_review",
      "other",
    ]),
    urgency: z.enum(["routine", "urgent", "emergency"]).default("routine"),
    riskRead: z.enum(["low", "medium", "high"]),
    summary: z.string().describe("One-line clinical-style situation summary"),
    coachingGuidance: z
      .string()
      .describe("Guidance for Scout's next coaching moves (not shown verbatim)"),
    patientSafeMessagePoints: z
      .array(z.string())
      .min(1)
      .max(6)
      .describe("Short points Scout may paraphrase to the patient"),
  }),
  async execute(input) {
    const brief = saveSageBrief(input);
    return {
      saved: true,
      briefId: brief.id,
      createdAt: brief.createdAt,
      urgency: brief.urgency,
      riskRead: brief.riskRead,
      summary: brief.summary,
      coachingGuidance: brief.coachingGuidance,
      patientSafeMessagePoints: brief.patientSafeMessagePoints,
    };
  },
});
