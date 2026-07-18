import { withEve } from "eve/next";

/**
 * withEve mounts the eve service and proxies `/eve/v1/**` (see eve Next.js docs).
 * Custom channel routes must be authored under `/eve/v1/...` so they are reachable
 * through that proxy — do not invent extra root-path rewrites.
 */
const nextConfig = {};

export default withEve(nextConfig, {
  eveBuildCommand: "npm run build:eve",
});
