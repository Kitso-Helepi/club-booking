/**
 * Process a VERIFIED provider event (signature already checked by the adapter).
 *
 * Guarantees:
 *  - Each provider event id is processed once (unique row in provider_events).
 *    A repeat returns the existing result and changes nothing.
 *  - Merchant, currency and amount must match what we asked for, or a
 *    reconciliation case is opened and nothing is confirmed.
 *  - Late success (hold already expired): confirm ONLY if the same inventory can
 *    still be taken atomically; otherwise open a reconciliation case, issue no passes.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { allocations, holds, orderLines, orders, paymentAttempts, providerEvents, reconciliationCases } from "@/db/schema";
import { audit } from "@/server/audit";
import { isAppError } from "@/server/errors";
import { lockEvent, priceAndCheckLines, sweepExpiredHolds } from "@/server/booking/holds";
import { confirmOrderInTx } from "@/server/booking/confirm";
import type { VerifiedProviderEvent } from "./provider";

export type ProcessOutcome =
  | "confirmed"
  | "confirmed_late"
  | "already_confirmed"
  | "duplicate"
  | "failed"
  | "reconciliation"
  | "mismatch"
  | "unknown_session"
  | "ignored";

export type ProcessResult = { outcome: ProcessOutcome; orderId?: string; orderState?: string };

async function openCase(tx: Tx, clubId: string, orderId: string, attemptId: string, reason: string) {
  await tx.insert(reconciliationCases).values({ clubId, orderId, paymentAttemptId: attemptId, reason });
  await audit(tx, {
    clubId,
    actorType: "provider",
    action: "reconciliation.opened",
    entityType: "order",
    entityId: orderId,
    data: { reason },
  });
}

export async function processProviderEvent(provider: string, ev: VerifiedProviderEvent): Promise<ProcessResult> {
  return db().transaction(async (tx) => {
    const inserted = await tx
      .insert(providerEvents)
      .values({
        provider,
        providerEventId: ev.providerEventId,
        type: ev.type,
        providerSessionId: ev.providerSessionId,
        payload: ev.raw as object,
      })
      .onConflictDoNothing({ target: [providerEvents.provider, providerEvents.providerEventId] })
      .returning({ id: providerEvents.id });

    const [attemptPeek] = await tx
      .select()
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.provider, provider), eq(paymentAttempts.providerSessionId, ev.providerSessionId)));

    if (inserted.length === 0) {
      // Duplicate delivery of an event we already handled.
      const [o] = attemptPeek
        ? await tx.select({ id: orders.id, state: orders.state }).from(orders).where(eq(orders.id, attemptPeek.orderId))
        : [];
      return { outcome: "duplicate", orderId: o?.id, orderState: o?.state };
    }
    const eventRowId = inserted[0].id;
    const finish = async (r: ProcessResult) => {
      await tx
        .update(providerEvents)
        .set({ outcome: r.outcome, processedAt: sql`now()` })
        .where(eq(providerEvents.id, eventRowId));
      return r;
    };

    if (!attemptPeek) return finish({ outcome: "unknown_session" });

    // Lock order: event row first (global order), then order, then attempt.
    const [orderPeek] = await tx.select().from(orders).where(eq(orders.id, attemptPeek.orderId));
    await lockEvent(tx, orderPeek.eventId);
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderPeek.id)).for("update");
    const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptPeek.id)).for("update");

    const matches =
      ev.merchantId === attempt.merchantId &&
      ev.currency === attempt.currency &&
      ev.amountMinor === attempt.amountMinor &&
      attempt.amountMinor === order.totalMinor &&
      attempt.currency === order.currency;

    if (!matches) {
      if (ev.type === "payment.succeeded") {
        await openCase(tx, order.clubId, order.id, attempt.id, "provider_details_mismatch");
      }
      return finish({ outcome: "mismatch", orderId: order.id, orderState: order.state });
    }

    if (ev.type === "payment.failed") {
      if (attempt.state === "created") {
        await tx.update(paymentAttempts).set({ state: "failed", updatedAt: sql`now()` }).where(eq(paymentAttempts.id, attempt.id));
      }
      if (order.state === "pending_payment") {
        await tx.update(orders).set({ state: "payment_failed", updatedAt: sql`now()` }).where(eq(orders.id, order.id));
        await tx
          .update(allocations)
          .set({ state: "released", updatedAt: sql`now()` })
          .where(and(eq(allocations.orderId, order.id), eq(allocations.state, "held")));
        await tx.update(holds).set({ state: "released", updatedAt: sql`now()` }).where(and(eq(holds.id, order.holdId), eq(holds.state, "active")));
        await audit(tx, { clubId: order.clubId, actorType: "provider", action: "payment.failed", entityType: "order", entityId: order.id });
        return finish({ outcome: "failed", orderId: order.id, orderState: "payment_failed" });
      }
      return finish({ outcome: "ignored", orderId: order.id, orderState: order.state });
    }

    // payment.succeeded
    await tx.update(paymentAttempts).set({ state: "succeeded", updatedAt: sql`now()` }).where(eq(paymentAttempts.id, attempt.id));

    if (order.state === "confirmed") {
      return finish({ outcome: "already_confirmed", orderId: order.id, orderState: order.state });
    }
    if (order.state === "cancelled" || order.state === "needs_reconciliation") {
      await openCase(tx, order.clubId, order.id, attempt.id, `payment_for_${order.state}_order`);
      return finish({ outcome: "reconciliation", orderId: order.id, orderState: order.state });
    }

    // pending_payment, payment_failed or expired.
    await sweepExpiredHolds(tx, order.eventId);
    const allocs = await tx.select().from(allocations).where(eq(allocations.orderId, order.id));
    const allStillHeld = allocs.length > 0 && allocs.every((a) => a.state === "held");

    if (allStillHeld) {
      const [fresh] = await tx.select().from(orders).where(eq(orders.id, order.id));
      await confirmOrderInTx(tx, fresh, { type: "provider" });
      return finish({ outcome: "confirmed", orderId: order.id, orderState: "confirmed" });
    }

    // Late payment: try to take the same inventory again, atomically.
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    try {
      await priceAndCheckLines(
        tx,
        { id: order.eventId, admissionCap: (await lockEvent(tx, order.eventId)).admissionCap },
        lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity })),
      );
    } catch (e) {
      if (isAppError(e) && (e.code === "unavailable" || e.code === "capacity_exceeded")) {
        await tx.update(orders).set({ state: "needs_reconciliation", updatedAt: sql`now()` }).where(eq(orders.id, order.id));
        await openCase(tx, order.clubId, order.id, attempt.id, "late_payment_inventory_unavailable");
        return finish({ outcome: "reconciliation", orderId: order.id, orderState: "needs_reconciliation" });
      }
      throw e;
    }
    await tx
      .update(allocations)
      .set({ state: "held", updatedAt: sql`now()` })
      .where(and(eq(allocations.orderId, order.id), inArray(allocations.state, ["expired", "released"])));
    const [fresh] = await tx.select().from(orders).where(eq(orders.id, order.id));
    await confirmOrderInTx(tx, fresh, { type: "provider" });
    await audit(tx, { clubId: order.clubId, actorType: "provider", action: "payment.late_confirmed", entityType: "order", entityId: order.id });
    return finish({ outcome: "confirmed_late", orderId: order.id, orderState: "confirmed" });
  });
}
