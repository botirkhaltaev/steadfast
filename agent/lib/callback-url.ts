/**
 * reply_callback is attacker-controlled if the webhook secret is unset.
 * Only allow HTTPS callbacks to known Wassist hosts (plus localhost for dev).
 */
export function isAllowedReplyCallback(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }

  // Production callbacks must be HTTPS.
  if (parsed.protocol !== "https:") return false;

  return (
    host === "wassist.app" ||
    host.endsWith(".wassist.app") ||
    host === "backend.wassist.app"
  );
}
