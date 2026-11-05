/**
 * Notification worker: sends due jobs, records every delivery attempt, and
 * retries failures with exponential backoff.
 *
 * A notification failing NEVER changes the booking: this code only touches
 * notification_jobs and delivery_attempts.
 *
 * Jobs are claimed with FOR UPDATE SKIP LOCKED, so two workers never send
 * the same job at the same time.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { deliveryAttempts, events, notificationJobs, orders, passes, venues } from "@/db/schema";
import { decryptToken } from "@/server/tokens";
import { formatMoney, formatVenueDateTime } from "@/lib/format";
import { isRecipientAllowed, type EmailSender, type OutgoingEmail } from "./email";

/** 1 min, 2, 4, 8, 16 ... capped at 1 hour. */
export function backoffSeconds(attempts: number) {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function buildConfirmationEmail(orderId: string): Promise<OutgoingEmail> {
  const [row] = await db()
    .select({ order: orders, event: events, venue: venues })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(eq(orders.id, orderId));
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const orderUrl = new URL(`/o/${decryptToken(row.order.accessTokenEncrypted)}`, base).toString();
  const ps = await db().select().from(passes).where(and(eq(passes.orderId, orderId), eq(passes.state, "valid"))).orderBy(asc(passes.label));
  const when = formatVenueDateTime(row.event.startsAt, row.venue.timezone);
  const passLinks = ps.map((p) => ({ label: p.label, url: new URL(`/p/${decryptToken(p.tokenEncrypted)}`, base).toString() }));
  const total = formatMoney(row.order.totalMinor, row.order.currency);

  const text = [
    `Hi ${row.order.buyerName},`,
    ``,
    `Your booking for ${row.event.title} at ${row.venue.name} (${when}) is confirmed.`,
    `Booking reference: ${row.order.bookingReference}`,
    `Total: ${total}`,
    ``,
    `Your private booking page (keep it to yourself): ${orderUrl}`,
    ``,
    `Individual passes. Send each guest only their own link:`,
    ...passLinks.map((p) => `- ${p.label}: ${p.url}`),
    ``,
    row.event.entryPolicy,
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(row.order.buyerName)},</p>
<p>Your booking for <strong>${escapeHtml(row.event.title)}</strong> at ${escapeHtml(row.venue.name)} (${escapeHtml(when)}) is confirmed.</p>
<p>Booking reference: <strong>${escapeHtml(row.order.bookingReference)}</strong><br>Total: ${escapeHtml(total)}</p>
<p><a href="${orderUrl}">Open your private booking page</a> (keep it to yourself).</p>
<p>Individual passes. Send each guest only their own link:</p>
<ul>${passLinks.map((p) => `<li><a href="${p.url}">${escapeHtml(p.label)}</a></li>`).join("")}</ul>
<p style="color:#666">${escapeHtml(row.event.entryPolicy)}</p>`;

  return { to: row.order.buyerEmail, subject: `Booking confirmed: ${row.event.title} (${row.order.bookingReference})`, text, html };
}

/** Process up to `limit` due jobs. Returns a summary (no personal data). */
export async function runNotificationBatch(sender: EmailSender, limit = 20) {
  // 1) Claim due jobs.
  const claimed = await db().transaction(async (tx) => {
    const due = await tx
      .select({ id: notificationJobs.id })
      .from(notificationJobs)
      .where(and(inArray(notificationJobs.state, ["pending", "failed"]), lte(notificationJobs.nextAttemptAt, sql`now()`), sql`${notificationJobs.attempts} < ${notificationJobs.maxAttempts}`))
      .orderBy(asc(notificationJobs.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!due.length) return [];
    return tx
      .update(notificationJobs)
      .set({ state: "sending", attempts: sql`${notificationJobs.attempts} + 1`, updatedAt: sql`now()` })
      .where(inArray(notificationJobs.id, due.map((d) => d.id)))
      .returning();
  });

  const summary = { sent: 0, failed: 0, skipped: 0 };
  for (const job of claimed) {
    try {
      if (job.channel !== "email") {
        // Automated WhatsApp (Meta Cloud API) is not implemented in the pilot.
        await db().update(notificationJobs).set({ state: "skipped", lastError: "whatsapp_adapter_disabled", updatedAt: sql`now()` }).where(eq(notificationJobs.id, job.id));
        summary.skipped++;
        continue;
      }
      const email = await buildConfirmationEmail(job.orderId);
      if (!isRecipientAllowed(email.to)) {
        await db().update(notificationJobs).set({ state: "skipped", lastError: "recipient_not_in_allowlist", updatedAt: sql`now()` }).where(eq(notificationJobs.id, job.id));
        summary.skipped++;
        continue;
      }
      const res = await sender.send(email);
      await db().transaction(async (tx) => {
        await tx.insert(deliveryAttempts).values({ jobId: job.id, success: true, providerMessageId: res.providerMessageId });
        await tx.update(notificationJobs).set({ state: "sent", providerMessageId: res.providerMessageId, lastError: null, updatedAt: sql`now()` }).where(eq(notificationJobs.id, job.id));
      });
      summary.sent++;
    } catch (e) {
      // Store only the error message (no recipient address).
      const message = (e instanceof Error ? e.message : "unknown error").slice(0, 300);
      await db().transaction(async (tx) => {
        await tx.insert(deliveryAttempts).values({ jobId: job.id, success: false, error: message });
        await tx
          .update(notificationJobs)
          .set({ state: "failed", lastError: message, nextAttemptAt: sql`now() + make_interval(secs => ${backoffSeconds(job.attempts)})`, updatedAt: sql`now()` })
          .where(eq(notificationJobs.id, job.id));
      });
      summary.failed++;
    }
  }
  return summary;
}
