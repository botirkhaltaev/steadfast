/**
 * Optional deploy-time env injection when Vercel project env is unavailable.
 * Git copy is a no-op; production deploys may overwrite this file in the
 * upload payload only (never commit real secrets).
 */
export {};
