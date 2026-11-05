/**
 * Booking guarantees, tested against REAL Postgres (no mocks).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { allocations, notificationJobs, orders, passes, reconciliationCases } from "@/db/schema";
import { createHold } from "@/server/booking/holds";
import { startCheckout } from "@/server/booking/checkout";
import { getItemAvailability } from "@/server/booking/availability";
import { getPaymentProvider } from "@/server/payments/provider";
import { isAppError } from "@/server/errors";
import { bookAndPay, buyer, deliverPayment, forceExpireHold, freshEvent, settle } from "./helpers";

const countPasses = async (orderId: string) =>
  (await db().select({ n: sql<number>`count(*)::int` }).from(passes).where(eq(passes.orderId, orderId)))[0].n;
const countJobs = async (orderId: string) =>
  (await db().select({ n: sql<number>`count(*)::int` }).from(notificationJobs).where(eq(notificationJobs.orderId, orderId)))[0].n;

describe("six-person table journey", () => {
  it("reserves the table, confirms via simulated payment and issues exactly six distinct passes", async () => {
    const ev = await freshEvent();
    const t1 = ev.item("t1");
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: t1.id, quantity: 1 }] });
    expect(hold.totalMinor).toBe(450000); // server price, not client
    expect(hold.admissions).toBe(6);
    expect(hold.expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    const checkout = await startCheckout(hold.holdId, buyer);
    expect(checkout.state).toBe("pending_payment");
    expect(checkout.redirectUrl).toMatch(/^\/simulator\/sim_/);
    expect(await countPasses(checkout.orderId)).toBe(0); // nothing before the webhook

    const result = await deliverPayment(checkout.orderId);
    expect(result.outcome).toBe("confirmed");

    const ps = await db().select().from(passes).where(eq(passes.orderId, checkout.orderId));
    expect(ps).toHaveLength(6);
    expect(new Set(ps.map((p) => p.tokenHash)).size).toBe(6);
    expect(ps.map((p) => p.label).sort()).toContain("T1 · Guest 6 of 6");
    expect(await countJobs(checkout.orderId)).toBe(1);

    const [o] = await db().select().from(orders).where(eq(orders.id, checkout.orderId));
    expect(o.state).toBe("confirmed");
    const avail = await getItemAvailability(db(), ev.event);
    expect(avail.find((a) => a.id === t1.id)?.displayState).toBe("sold");
  });
});

describe("concurrency", () => {
  it("two simultaneous attempts for the last table produce one allocation", async () => {
    const ev = await freshEvent();
    const t2 = ev.item("t2");
    const attempts = Array.from({ length: 8 }, () =>
      createHold({ eventId: ev.event, items: [{ inventoryItemId: t2.id, quantity: 1 }] }),
    );
    const { ok, errors } = await settle(attempts);
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(7);
    expect(errors.every((e) => isAppError(e) && e.code === "unavailable")).toBe(true);
    const active = await db()
      .select()
      .from(allocations)
      .where(and(eq(allocations.inventoryItemId, t2.id), inArray(allocations.state, ["held", "confirmed"])));
    expect(active).toHaveLength(1);
  });

  it("two simultaneous attempts for the last seat produce one allocation", async () => {
    const ev = await freshEvent();
    const b1 = ev.item("b1");
    const { ok } = await settle([1, 2].map(() => createHold({ eventId: ev.event, items: [{ inventoryItemId: b1.id, quantity: 1 }] })));
    expect(ok).toHaveLength(1);
  });

  it("concurrent bookings cannot exceed the event admission cap (table passes count too)", async () => {
    const ev = await freshEvent({ admissionCap: 10 });
    const ga = ev.item("ga");
    // A 6-person table takes 6 of the 10 admissions.
    await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t1").id, quantity: 1 }]);
    const { ok, errors } = await settle(
      Array.from({ length: 12 }, () => createHold({ eventId: ev.event, items: [{ inventoryItemId: ga.id, quantity: 1 }] })),
    );
    expect(ok).toHaveLength(4);
    expect(errors.every((e) => isAppError(e) && e.code === "capacity_exceeded")).toBe(true);
    const [{ used }] = await db()
      .select({ used: sql<number>`sum(${allocations.admissions})::int` })
      .from(allocations)
      .where(and(eq(allocations.eventId, ev.event), inArray(allocations.state, ["held", "confirmed"])));
    expect(used).toBe(10);
  });

  it("rejects the whole basket atomically if any part is unavailable", async () => {
    const ev = await freshEvent();
    await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("b2").id, quantity: 1 }] });
    await expect(
      createHold({
        eventId: ev.event,
        items: [
          { inventoryItemId: ev.item("b3").id, quantity: 1 },
          { inventoryItemId: ev.item("b2").id, quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const b3 = await db().select().from(allocations).where(eq(allocations.inventoryItemId, ev.item("b3").id));
    expect(b3).toHaveLength(0);
  });
});

describe("hold expiry", () => {
  it("an expired hold frees inventory even before any cleanup runs", async () => {
    const ev = await freshEvent();
    const t3 = ev.item("t3");
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: t3.id, quantity: 1 }] });
    expect((await getItemAvailability(db(), ev.event)).find((a) => a.id === t3.id)?.displayState).toBe("held");
    await forceExpireHold(hold.holdId);
    expect((await getItemAvailability(db(), ev.event)).find((a) => a.id === t3.id)?.displayState).toBe("available");
    await expect(createHold({ eventId: ev.event, items: [{ inventoryItemId: t3.id, quantity: 1 }] })).resolves.toBeTruthy();
  });

  it("checkout is refused after the hold expires", async () => {
    const ev = await freshEvent();
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("t4").id, quantity: 1 }] });
    await forceExpireHold(hold.holdId);
    await expect(startCheckout(hold.holdId, buyer)).rejects.toMatchObject({ code: "hold_expired" });
  });
});

describe("payment events", () => {
  it("duplicate payment notifications create no additional passes or confirmation jobs", async () => {
    const ev = await freshEvent();
    const { checkout } = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t1").id, quantity: 1 }]);
    // Same event id delivered again, then a different event id for the same payment.
    const fixedId = "evt_fixed_duplicate";
    const first = await deliverPayment(checkout.orderId, "payment.succeeded", fixedId);
    const again = await deliverPayment(checkout.orderId, "payment.succeeded", fixedId);
    expect(first.outcome).toBe("already_confirmed");
    expect(again.outcome).toBe("duplicate");
    expect(await countPasses(checkout.orderId)).toBe(6);
    expect(await countJobs(checkout.orderId)).toBe(1);
  });

  it("concurrent duplicate deliveries still issue exactly six passes", async () => {
    const ev = await freshEvent();
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("t2").id, quantity: 1 }] });
    const checkout = await startCheckout(hold.holdId, buyer);
    const results = await settle([1, 2, 3].map(() => deliverPayment(checkout.orderId, "payment.succeeded", "evt_same")));
    expect(results.ok.map((r) => r.outcome).sort()).toEqual(["confirmed", "duplicate", "duplicate"]);
    expect(await countPasses(checkout.orderId)).toBe(6);
  });

  it("late payment for resold inventory creates a reconciliation case and no passes", async () => {
    const ev = await freshEvent();
    const t1 = ev.item("t1").id;
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: t1, quantity: 1 }] });
    const late = await startCheckout(hold.holdId, buyer);
    await forceExpireHold(hold.holdId);
    const other = await bookAndPay(ev.event, [{ inventoryItemId: t1, quantity: 1 }]);
    expect(other.result.outcome).toBe("confirmed");

    const result = await deliverPayment(late.orderId);
    expect(result.outcome).toBe("reconciliation");
    expect(await countPasses(late.orderId)).toBe(0);
    const cases = await db().select().from(reconciliationCases).where(eq(reconciliationCases.orderId, late.orderId));
    expect(cases).toHaveLength(1);
    expect(cases[0].reason).toBe("late_payment_inventory_unavailable");
    const [o] = await db().select().from(orders).where(eq(orders.id, late.orderId));
    expect(o.state).toBe("needs_reconciliation");
  });

  it("late payment is confirmed when the inventory is still free", async () => {
    const ev = await freshEvent();
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("t3").id, quantity: 1 }] });
    const checkout = await startCheckout(hold.holdId, buyer);
    await forceExpireHold(hold.holdId);
    const result = await deliverPayment(checkout.orderId);
    expect(result.outcome).toBe("confirmed_late");
    expect(await countPasses(checkout.orderId)).toBe(4);
  });

  it("a failed payment releases the hold so others can book", async () => {
    const ev = await freshEvent();
    const t4 = ev.item("t4").id;
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: t4, quantity: 1 }] });
    const checkout = await startCheckout(hold.holdId, buyer);
    expect((await deliverPayment(checkout.orderId, "payment.failed")).outcome).toBe("failed");
    await expect(createHold({ eventId: ev.event, items: [{ inventoryItemId: t4, quantity: 1 }] })).resolves.toBeTruthy();
  });

  it("an amount mismatch opens a reconciliation case and confirms nothing", async () => {
    const ev = await freshEvent();
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("b4").id, quantity: 1 }] });
    const checkout = await startCheckout(hold.holdId, buyer);
    const result = await deliverPayment(checkout.orderId, "payment.succeeded", undefined, { amountMinor: 1 });
    expect(result.outcome).toBe("mismatch");
    expect(await countPasses(checkout.orderId)).toBe(0);
  });

  it("rejects webhook bodies with a bad signature", async () => {
    const p = getPaymentProvider();
    await expect(p.parseWebhook('{"id":"x"}', new Headers({ "x-simulator-signature": "nope" }))).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });

  it("the simulator is refused in live mode", () => {
    const prev = process.env.PAYMENTS_MODE;
    process.env.PAYMENTS_MODE = "live";
    try {
      expect(() => getPaymentProvider("simulator")).toThrowError(/disabled in live mode/);
    } finally {
      process.env.PAYMENTS_MODE = prev;
    }
  });
});

describe("general admission and seats", () => {
  it("issues one pass per GA unit and one per seat", async () => {
    const ev = await freshEvent();
    const { checkout } = await bookAndPay(ev.event, [
      { inventoryItemId: ev.item("ga").id, quantity: 3 },
      { inventoryItemId: ev.item("b5").id, quantity: 1 },
    ]);
    expect(await countPasses(checkout.orderId)).toBe(4);
  });

  it("refuses quantity > 1 on a seat or table", async () => {
    const ev = await freshEvent();
    await expect(createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("b6").id, quantity: 2 }] })).rejects.toMatchObject({
      code: "validation",
    });
  });
});
