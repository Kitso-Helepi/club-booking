import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { deliveryAttempts, notificationJobs, orders, passes } from "@/db/schema";
import { runNotificationBatch, sendNotificationsForOrder } from "@/server/notifications/worker";
import type { EmailSender } from "@/server/notifications/email";
import { bookAndPay, freshEvent } from "./helpers";

const jobFor = async (orderId: string) =>
  (await db().select().from(notificationJobs).where(eq(notificationJobs.orderId, orderId)))[0];

describe("sending right after confirmation", () => {
  it("sends only the confirmed order's job, leaving other orders for the worker", async () => {
    const ev = await freshEvent();
    const a = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t1").id, quantity: 1 }]);
    const b = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t2").id, quantity: 1 }]);
    const subjects: string[] = [];
    const ok: EmailSender = { send: async (m) => { subjects.push(m.subject); return { providerMessageId: "now-1" }; } };

    await sendNotificationsForOrder(a.checkout.orderId, ok);

    expect((await jobFor(a.checkout.orderId)).state).toBe("sent");
    expect((await jobFor(b.checkout.orderId)).state).toBe("pending");
    expect(subjects).toEqual([expect.stringContaining(a.checkout.bookingReference)]);
  });

  it("never throws when sending fails, and leaves the job for the worker to retry", async () => {
    const ev = await freshEvent();
    const { checkout } = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t3").id, quantity: 1 }]);
    const broken: EmailSender = { send: async () => { throw new Error("SMTP down"); } };

    await expect(sendNotificationsForOrder(checkout.orderId, broken)).resolves.toBeUndefined();

    const job = await jobFor(checkout.orderId);
    expect(job.state).toBe("failed");
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await db().select().from(orders).where(eq(orders.id, checkout.orderId)))[0].state).toBe("confirmed");
  });

  it("never throws when the database query itself fails", async () => {
    // Postgres rejects a malformed uuid: a real database error, not a sender error.
    const ok: EmailSender = { send: async () => ({ providerMessageId: "x" }) };
    await expect(sendNotificationsForOrder("not-a-uuid", ok)).resolves.toBeUndefined();
  });

  it("does not resend a job that was already sent", async () => {
    const ev = await freshEvent();
    const { checkout } = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t4").id, quantity: 1 }]);
    // Count only THIS order's emails: the worker batch below also drains other
    // tests' pending jobs from the shared test database.
    let sends = 0;
    const ok: EmailSender = {
      send: async (m) => {
        if (m.subject.includes(checkout.bookingReference)) sends++;
        return { providerMessageId: "once" };
      },
    };

    await sendNotificationsForOrder(checkout.orderId, ok);
    await sendNotificationsForOrder(checkout.orderId, ok);
    await runNotificationBatch(ok, 500);

    expect(sends).toBe(1);
  });
});

describe("notifications", () => {
  it("failed notifications can be retried without changing booking state", async () => {
    const ev = await freshEvent();
    const { checkout } = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t3").id, quantity: 1 }]);
    const [job] = await db().select().from(notificationJobs).where(eq(notificationJobs.orderId, checkout.orderId));
    const orderBefore = (await db().select().from(orders).where(eq(orders.id, checkout.orderId)))[0];
    const passesBefore = await db().select().from(passes).where(eq(passes.orderId, checkout.orderId));

    const broken: EmailSender = { send: async () => { throw new Error("SMTP connection refused"); } };
    await runNotificationBatch(broken, 500);
    let [j] = await db().select().from(notificationJobs).where(eq(notificationJobs.id, job.id));
    expect(j.state).toBe("failed");
    expect(j.attempts).toBe(1);
    expect(j.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Booking untouched by the failure.
    const orderAfter = (await db().select().from(orders).where(eq(orders.id, checkout.orderId)))[0];
    expect(orderAfter.state).toBe("confirmed");
    expect(orderAfter.updatedAt.getTime()).toBe(orderBefore.updatedAt.getTime());
    expect(await db().select().from(passes).where(eq(passes.orderId, checkout.orderId))).toHaveLength(passesBefore.length);

    // Make it due again (as if the backoff elapsed) and retry with a working sender.
    await db().update(notificationJobs).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationJobs.id, job.id));
    const sent: string[] = [];
    const ok: EmailSender = { send: async (m) => { sent.push(m.subject); return { providerMessageId: "msg-1" }; } };
    await runNotificationBatch(ok, 500);
    [j] = await db().select().from(notificationJobs).where(eq(notificationJobs.id, job.id));
    expect(j.state).toBe("sent");
    expect(j.providerMessageId).toBe("msg-1");
    expect(sent.some((s) => s.includes(checkout.bookingReference))).toBe(true);
    const attempts = await db().select().from(deliveryAttempts).where(eq(deliveryAttempts.jobId, job.id));
    expect(attempts.map((a) => a.success)).toEqual([false, true]);
    expect((await db().select().from(orders).where(eq(orders.id, checkout.orderId)))[0].state).toBe("confirmed");
  });

  it("skips recipients outside the allowlist in allowlist mode", async () => {
    const ev = await freshEvent();
    const { checkout } = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t4").id, quantity: 1 }]);
    process.env.EMAIL_DELIVERY_MODE = "allowlist";
    process.env.EMAIL_ALLOWED_RECIPIENTS = "@approved.test";
    try {
      const ok: EmailSender = { send: async () => ({ providerMessageId: "x" }) };
      await runNotificationBatch(ok, 500);
      const [j] = await db().select().from(notificationJobs).where(eq(notificationJobs.orderId, checkout.orderId));
      expect(j.state).toBe("skipped");
      expect(j.lastError).toBe("recipient_not_in_allowlist");
    } finally {
      process.env.EMAIL_DELIVERY_MODE = "capture";
      process.env.EMAIL_ALLOWED_RECIPIENTS = "";
    }
  });
});
