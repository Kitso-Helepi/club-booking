/**
 * Applies pending SQL migrations from ./drizzle using the MIGRATION role.
 * Safe to run repeatedly: already-applied migrations are skipped.
 * It never drops or resets anything.
 *
 *   npm run db:migrate
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(url: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/migrate.ts");
if (isMain) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("Migrations applied."))
    .catch((err) => {
      console.error("Migration failed:", err.message);
      process.exit(1);
    });
}
