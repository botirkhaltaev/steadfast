import { defineTool } from "eve/tools";
import { z } from "zod";
import { listEmedReadings } from "#lib/store";

/** Sage-only — clinical biomarker time series. Scout must not call this. */
export default defineTool({
  description:
    "Load durable eMed biomarker readings for clinical review (Sage). Includes latest snapshot and recent trend. Call when drafting briefs, risk review, or red-flag context. Never invent vitals.",
  inputSchema: z.object({
    phoneNumber: z.string().describe("WhatsApp phone in E.164 form"),
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7)
      .describe("How many days of trend to return"),
  }),
  async execute({ phoneNumber, days }) {
    const { device, latest, trend } = listEmedReadings(phoneNumber, days);
    if (!device) {
      return {
        linked: false as const,
        deviceId: null,
        latest: null,
        trend7d: [] as const,
        units: {
          weight: "kg",
          glucose: "mmol/L",
          restingHr: "bpm",
          bloodPressure: "mmHg",
        },
      };
    }
    return {
      linked: true as const,
      deviceId: device.deviceId,
      deviceLabel: device.label,
      latest,
      trend7d: trend,
      units: {
        weight: "kg",
        glucose: "mmol/L",
        restingHr: "bpm",
        bloodPressure: "mmHg",
      },
    };
  },
});
