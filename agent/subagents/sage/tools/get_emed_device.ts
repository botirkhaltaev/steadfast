import { defineTool } from "eve/tools";
import { z } from "zod";
import { getEmedDevice } from "#lib/store";

/** Sage-only — clinical device registry. Scout must not call this. */
export default defineTool({
  description:
    "Load the patient's linked eMed home monitor (Sage / clinical). Call when reviewing biomarkers or drafting a clinical brief. Returns linked:false if none.",
  inputSchema: z.object({
    phoneNumber: z.string().describe("WhatsApp phone in E.164 form"),
  }),
  async execute({ phoneNumber }) {
    const device = getEmedDevice(phoneNumber);
    if (!device) {
      return { linked: false as const, device: null };
    }
    return { linked: true as const, device };
  },
});
