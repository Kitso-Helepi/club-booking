import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { allocations, holds, inventoryItems, paymentAttempts } from "@/db/schema";
import { ensureClubWithEvent, type FixtureOptions } from "@/server/fixtures";
import { createHold } from "@/server/booking/holds";
import { startCheckout } from "@/server/booking/checkout";
import { buildSimulatorEvent, simulatorProvider } from "@/server/payments/simulator";
import { processProviderEvent } from "@/server/payments/process-event";

/** A fresh, isolated club + event for one test. */
export async function freshEvent(opts: FixtureOptions = {}) {
  const suffix = randomUUID().slice(0, 8);
  const ids = await ensureClubWithEvent(db(), { clubSlug: `club-${suffix}`, clubName: `Test Club ${suffix}`, ...opts });
  const items = await db().select().from(inventoryItems).where(eq(inventoryItems.eventId, ids.event));
  const item = (key: string) => {
    const found = key === "ga" ? items.find((i) => i.kind === "general_admission") : items.find((i) => i.objectKey === key);
    if (!found) throw new Error(`No item ${key}`);
    return found;
  };
  return { ...ids, items, item };
}

export const buyer = { buyerName: "Test Guest", buyerEmail: "guest@example.test", whatsappOptIn: false };

/** Simulate the provider sending a signed webhook and process it. */
export async function deliverPayment(orderId: string, type: "payment.succeeded" | "payment.failed" = "payment.succeeded", eventId?: string, overrides: { amountMinor?: number } = {}) {
  const [attempt] = await db()
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.orderId, orderId), eq(paymentAttempts.state, "created")));
  const a = attempt ?? (await db().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)))[0];
  const { body, signature } = buildSimulatorEvent({
    id: eventId,
    type,
    session_id: a.providerSessionId,
    merchant_id: a.merchantId,
    amount_minor: overrides.amountMinor ?? a.amountMinor,
    currency: a.currency,
  });
  const verified = await simulatorProvider.parseWebhook(body, new Headers({ "x-simulator-signature": signature }));
  return processProviderEvent("simulator", verified);
}

export async function bookAndPay(eventId: string, lines: { inventoryItemId: string; quantity: number }[]) {
  const hold = await createHold({ eventId, items: lines });
  const checkout = await startCheckout(hold.holdId, buyer);
  const result = checkout.state === "confirmed" ? { outcome: "confirmed" as const } : await deliverPayment(checkout.orderId);
  return { hold, checkout, result };
}

/** Test-only: make a hold look like its 10 minutes ran out. */
export async function forceExpireHold(holdId: string) {
  await db().update(holds).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(holds.id, holdId));
  await db().update(allocations).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(allocations.holdId, holdId));
}

export async function settle<T>(promises: Promise<T>[]) {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === "fulfilled").map((r) => r.value),
    errors: results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason),
  };
}
