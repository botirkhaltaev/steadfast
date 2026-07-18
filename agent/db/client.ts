import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required (Neon via Vercel Marketplace). Run `vercel env pull .env.local`.",
    );
  }
  return url;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Shared Drizzle client (Neon HTTP — serverless-safe). */
export function getDb() {
  if (!_db) {
    const sql = neon(requireDatabaseUrl());
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export type Db = ReturnType<typeof getDb>;
