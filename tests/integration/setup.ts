/** Per-file setup: point the app at the TEST database using the APP role. */
import { afterAll } from "vitest";
import { closeDb } from "@/db/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI */
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.HOLD_MINUTES ??= "10";
process.env.PAYMENTS_MODE = "test";
process.env.PAYMENT_PROVIDER = "simulator";
process.env.PAYMENT_SIMULATOR_SECRET ||= "test-simulator-secret-0123456789";
process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.WHATSAPP_AUTOMATION_ENABLED = "false";
process.env.DATABASE_POOL_MAX = "20";

afterAll(async () => {
  await closeDb();
});
