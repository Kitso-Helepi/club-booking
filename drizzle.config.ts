import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional (CI sets env vars directly).
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Migrations always use the migration role (direct connection on Neon).
    url: process.env.MIGRATION_DATABASE_URL ?? "",
  },
  strict: true,
});
