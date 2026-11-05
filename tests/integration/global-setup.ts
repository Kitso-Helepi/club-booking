/**
 * Runs once before integration tests: migrates the TEST database and empties it.
 * Refuses to run against any database whose name does not end in "_test".
 */
import { Pool } from "pg";
import { runMigrations } from "../../scripts/migrate";

function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* CI provides env vars directly */
  }
}

export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${name}": database name must end in _test`);
  }
}

export default async function setup() {
  loadEnv();
  const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!migrationUrl || !appUrl) {
    throw new Error("TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL must be set (see .env.example)");
  }
  assertTestDatabase(migrationUrl);
  assertTestDatabase(appUrl);
  await runMigrations(migrationUrl);

  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length) {
      await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await pool.end();
  }
}
