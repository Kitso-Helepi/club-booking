/**
 * Sends pending notification jobs.
 *   npm run worker:notifications          # one batch, then exit
 *   npm run worker:notifications -- --watch   # keep polling every 5s (local dev)
 * In staging, run the single-batch form on a schedule (cron).
 */
import { closeDb } from "@/db/client";
import { smtpSender } from "@/server/notifications/email";
import { runNotificationBatch } from "@/server/notifications/worker";

async function main() {
  const sender = smtpSender();
  const watch = process.argv.includes("--watch");
  do {
    const s = await runNotificationBatch(sender);
    if (s.sent || s.failed || s.skipped) console.log(`notifications: sent=${s.sent} failed=${s.failed} skipped=${s.skipped}`);
    if (watch) await new Promise((r) => setTimeout(r, 5000));
  } while (watch);
}

main()
  .catch((e) => {
    console.error("Worker failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
