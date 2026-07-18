import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    vercelOidc(),
    localDev(),
    // WhatsApp traffic uses /webhook (Wassist channel), not these routes.
    // Keep none() so hackathon curl/session demos work; remove before public launch.
    none(),
  ],
});
