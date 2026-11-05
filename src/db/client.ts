/**
 * Database connection.
 *
 * Why node-postgres (`pg`) over TCP and not the Neon HTTP driver?
 * Booking needs interactive transactions with `SELECT ... FOR UPDATE` row locks.
 * The Neon HTTP driver cannot hold a transaction open across round trips;
 * a normal TCP connection (to Neon's pooled endpoint for the app, or the direct
 * endpoint for migrations) can. Neon's pooler runs PgBouncer in transaction mode,
 * which keeps a transaction on one server connection — exactly what we need.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { __clubPool?: Pool; __clubDb?: Db };

export function getPool(): Pool {
  if (!globalForDb.__clubPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForDb.__clubPool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // Fail fast instead of hanging forever on a bad network.
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForDb.__clubPool;
}

export function db(): Db {
  if (!globalForDb.__clubDb) {
    globalForDb.__clubDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__clubDb;
}

export async function closeDb() {
  await globalForDb.__clubPool?.end();
  globalForDb.__clubPool = undefined;
  globalForDb.__clubDb = undefined;
}

export { schema };
