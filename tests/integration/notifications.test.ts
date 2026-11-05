import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { deliveryAttempts, notificationJobs, orders, passes } from "@/db/schema";
import { runNotificationBatch } from "@/server/notifications/worker";
import type { EmailSender } from "@/server/notifications/email";
import { bookAndPay, freshEvent } from "./helpers";

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
