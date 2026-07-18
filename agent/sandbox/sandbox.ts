import { defineSandbox, defaultBackend } from "eve/sandbox";

// Environment-aware backend: Vercel Sandbox on Vercel, local elsewhere.
// Image attachments stage into the sandbox even when shell/file tools are disabled.
export default defineSandbox({
  backend: defaultBackend(),
});
