import { withEve } from "eve/next";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Custom channel routes live on the eve Nitro server (not under /eve/v1).
 * withEve only proxies /eve/v1/* — these rewrites keep Wassist + clinician
 * APIs same-origin with the Next.js UI.
 */
const CHANNEL_PROXY_SOURCES = [
  "/clinician/:path*",
  "/webhook",
  "/health",
  "/reset-all",
  "/proactive-checkin",
];

const EVE_SERVICE_NAME = "eve";
const EVE_INTERNAL_PREFIX = "/_eve_internal/eve";

function isRewriteSections(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractEveOrigin(destination) {
  try {
    // e.g. http://127.0.0.1:4321/eve/v1/:path+
    const trimmed = destination.replace(/\/eve\/v1\/:path\+?$/, "");
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function channelRewrites(destinationPrefix) {
  const prefix = destinationPrefix.replace(/\/+$/, "");
  return CHANNEL_PROXY_SOURCES.map((source) => ({
    source,
    destination: `${prefix}${source}`,
  }));
}

async function patchVercelEveChannelRoutes(nextRoot) {
  if (!process.env.VERCEL) return;

  const configPath = join(nextRoot, ".vercel", "output", "config.json");
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return;
  }

  const channelRouteSrcs = [
    "^/clinician(?:/(.*))?$",
    "^/webhook$",
    "^/health$",
    "^/reset-all$",
    "^/proactive-checkin$",
  ];

  const existing = config.routes ?? [];
  const withoutChannel = existing.filter((route) => {
    const src = typeof route.src === "string" ? route.src : "";
    return !channelRouteSrcs.includes(src);
  });

  const channelRoutes = channelRouteSrcs.map((src) => ({
    src,
    destination: { type: "service", service: EVE_SERVICE_NAME },
  }));

  const filesystemIdx = withoutChannel.findIndex(
    (route) => route.handle === "filesystem",
  );
  const routes =
    filesystemIdx === -1
      ? [...channelRoutes, ...withoutChannel]
      : [
          ...withoutChannel.slice(0, filesystemIdx),
          ...channelRoutes,
          ...withoutChannel.slice(filesystemIdx),
        ];

  const next = { ...config, routes, version: config.version ?? 3 };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

const nextConfig = {
  // Clinician UI + Eve agent are one deploy; channel APIs proxy to Eve.
};

const withEveConfig = withEve(nextConfig, {
  eveBuildCommand: "npm run build:eve",
});

export default async function eveNextConfig(phase, context) {
  const config = await withEveConfig(phase, context);
  await patchVercelEveChannelRoutes(process.cwd());

  const originalRewrites = config.rewrites;

  return {
    ...config,
    async rewrites() {
      const existing = originalRewrites ? await originalRewrites() : undefined;

      // On Vercel, withEve skips Next rewrites and uses Build Output services.
      // Route public channel paths into the private eve service namespace.
      if (process.env.VERCEL) {
        const vercelChannel = channelRewrites(EVE_INTERNAL_PREFIX);
        if (existing === undefined) return vercelChannel;
        if (isRewriteSections(existing)) {
          return {
            ...existing,
            beforeFiles: [...vercelChannel, ...(existing.beforeFiles ?? [])],
          };
        }
        return { beforeFiles: vercelChannel, afterFiles: existing };
      }

      const beforeFiles = isRewriteSections(existing)
        ? (existing.beforeFiles ?? [])
        : [];
      const eveRule = beforeFiles.find((rule) =>
        rule.source.includes("/eve/v1/"),
      );
      const origin = eveRule ? extractEveOrigin(eveRule.destination) : null;
      const channelRules = origin ? channelRewrites(origin) : [];

      if (existing === undefined) {
        return { beforeFiles: channelRules };
      }
      if (isRewriteSections(existing)) {
        return {
          ...existing,
          beforeFiles: [...channelRules, ...(existing.beforeFiles ?? [])],
        };
      }
      return {
        beforeFiles: channelRules,
        afterFiles: existing,
      };
    },
  };
}
