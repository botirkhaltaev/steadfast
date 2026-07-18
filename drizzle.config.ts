import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config({ path: ".env" });

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED (or DATABASE_URL) is required for drizzle-kit",
  );
}

export default defineConfig({
  schema: "./agent/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
