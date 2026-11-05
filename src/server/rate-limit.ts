/**
 * Fixed-window rate limit for public endpoints (holds, checkout, lookups).
 * Stored in Postgres (shared rate_limit table, keys prefixed "app:") so it works
 * across serverless instances. IPs are hashed, never stored raw.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jsonError } from "./http";

function clientKey(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/** Returns a 429 response when over the limit, otherwise null. */
export async function rateLimit(req: Request, bucket: string, max: number, windowSeconds: number) {
  if (process.env.RATE_LIMIT_DISABLED === "true") return null;
  const key = `app:${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const result = await db().execute<{ count: number }>(sql`
    insert into rate_limit (id, key, count, last_request)
    values (${randomUUID()}, ${key}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limit.last_request < ${windowStart} then 1 else rate_limit.count + 1 end,
      last_request = case when rate_limit.last_request < ${windowStart} then ${now} else rate_limit.last_request end
    returning count`);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > max) return jsonError(429, "rate_limited", "Too many attempts. Please wait a minute and try again.");
  return null;
}
