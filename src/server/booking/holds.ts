/**
 * Creating a hold = reserving a whole basket for a short time.
 *
 * Steps (all inside ONE database transaction):
 *  1. Validate the request shape.
 *  2. Lock the event row (FOR UPDATE). Every hold/confirm/cancel for an event
 *     locks this row first, so they run one at a time per event. This is our
 *     "consistent lock order": event row, then inventory rows sorted by id.
 *  3. Mark expired holds as expired (housekeeping; availability is already correct).
 *  4. Check each item is available and the event admission cap is not exceeded.
 *  5. Insert the hold + allocations, or throw and roll everything back.
 *  6. Return the hold id, expiry, currency and server-calculated total.
 *
 * A partial unique index on allocations is a second line of defence: even if
 * the logic above had a bug, Postgres refuses two active allocations for one
 * seat or table.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { allocations, events, holds, inventoryItems, orders, ticketTypes } from "@/db/schema";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit";
import { activeAllocation, getAdmissionsUsed } from "./availability";

export const createHoldInput = z.object({
  eventId: z.string().uuid(),
  items: z
    .array(
      z.object({
        inventoryItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(20)
    .refine((items) => new Set(items.map((i) => i.inventoryItemId)).size === items.length, {
      message: "Each item may appear only once",
    }),
});
export type CreateHoldInput = z.infer<typeof createHoldInput>;

export type HoldResult = {
  holdId: string;
  expiresAt: Date;
  currency: string;
  totalMinor: number;
  admissions: number;
};

function holdMinutes() {
  const n = Number(process.env.HOLD_MINUTES ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Lock an event row. Always call this FIRST in any inventory-changing transaction. */
export async function lockEvent(tx: Tx, eventId: string) {
  const [ev] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
  return ev;
}

/** Expire overdue holds for an event. Requires the event row to be locked. */
export async function sweepExpiredHolds(tx: Tx, eventId: string) {
  const expired = await tx
    .update(allocations)
    .set({ state: "expired", updatedAt: sql`now()` })
    .where(and(eq(allocations.eventId, eventId), eq(allocations.state, "held"), lte(allocations.expiresAt, sql`now()`)))
    .returning({ holdId: allocations.holdId });
  const holdIds = [...new Set(expired.map((e) => e.holdId))];
  if (holdIds.length) {
    await tx
      .update(holds)
      .set({ state: "expired", updatedAt: sql`now()` })
      .where(and(inArray(holds.id, holdIds), eq(holds.state, "active")));
    await tx
      .update(orders)
      .set({ state: "expired", updatedAt: sql`now()` })
      .where(and(inArray(orders.holdId, holdIds), eq(orders.state, "pending_payment")));
  }
}

type LineRequest = { inventoryItemId: string; quantity: number };

/**
 * Check that `lines` can be taken right now. Requires the event row lock.
 * `ignoreHoldId` lets a late payment re-check its own (expired) basket.
 * Returns priced lines or throws AppError("unavailable" | "capacity_exceeded").
 */
export async function priceAndCheckLines(
  tx: Tx,
  event: { id: string; admissionCap: number },
  lines: LineRequest[],
) {
  const ids = lines.map((l) => l.inventoryItemId);
  const items = await tx
    .select({
      id: inventoryItems.id,
      kind: inventoryItems.kind,
      label: inventoryItems.label,
      capacity: inventoryItems.capacity,
      status: inventoryItems.status,
      ticketTypeId: ticketTypes.id,
      priceMinor: ticketTypes.priceMinor,
      admissionsPerUnit: ticketTypes.admissionsPerUnit,
    })
    .from(inventoryItems)
    .innerJoin(ticketTypes, eq(ticketTypes.id, inventoryItems.ticketTypeId))
    .where(and(eq(inventoryItems.eventId, event.id), inArray(inventoryItems.id, ids)))
    .orderBy(asc(inventoryItems.id))
    .for("update", { of: inventoryItems });

  if (items.length !== ids.length) {
    throw new AppError("validation", "One or more items do not belong to this event");
  }

  const taken = await tx
    .select({
      itemId: allocations.inventoryItemId,
      units: sql<number>`coalesce(sum(${allocations.quantity}), 0)::int`,
    })
    .from(allocations)
    .where(and(inArray(allocations.inventoryItemId, ids), activeAllocation))
    .groupBy(allocations.inventoryItemId);
  const takenBy = new Map(taken.map((t) => [t.itemId, t.units]));

  const priced = lines.map((line) => {
    const item = items.find((i) => i.id === line.inventoryItemId)!;
    if (item.status !== "active") {
      throw new AppError("unavailable", `${item.label} is not available`, { itemId: item.id });
    }
    if (item.kind !== "general_admission" && line.quantity !== 1) {
      throw new AppError("validation", `${item.label} can only be booked once`);
    }
    const remaining = item.capacity - (takenBy.get(item.id) ?? 0);
    if (line.quantity > remaining) {
      throw new AppError("unavailable", `${item.label} is no longer available`, { itemId: item.id, remaining });
    }
    return {
      item,
      quantity: line.quantity,
      unitPriceMinor: item.priceMinor,
      admissions: line.quantity * item.admissionsPerUnit,
      lineTotalMinor: line.quantity * item.priceMinor,
    };
  });

  const requestedAdmissions = priced.reduce((s, p) => s + p.admissions, 0);
  const used = await getAdmissionsUsed(tx, event.id);
  if (used + requestedAdmissions > event.admissionCap) {
    throw new AppError("capacity_exceeded", "This event has reached its admission limit", {
      remaining: Math.max(0, event.admissionCap - used),
    });
  }

  return {
    priced,
    totalMinor: priced.reduce((s, p) => s + p.lineTotalMinor, 0),
    admissions: requestedAdmissions,
  };
}

export async function createHold(rawInput: unknown): Promise<HoldResult> {
  const input = createHoldInput.parse(rawInput);

  return db().transaction(async (tx) => {
    const event = await lockEvent(tx, input.eventId);
    if (!event || event.status !== "published") throw new AppError("not_found", "Event not found");
    if (event.endsAt.getTime() <= Date.now()) throw new AppError("unavailable", "This event has ended");

    await sweepExpiredHolds(tx, event.id);
    const { priced, totalMinor, admissions } = await priceAndCheckLines(tx, event, input.items);

    const [hold] = await tx
      .insert(holds)
      .values({
        clubId: event.clubId,
        eventId: event.id,
        currency: event.currency,
        totalMinor,
        expiresAt: sql`now() + make_interval(mins => ${holdMinutes()})`,
      })
      .returning();

    await tx.insert(allocations).values(
      priced.map((p) => ({
        clubId: event.clubId,
        eventId: event.id,
        inventoryItemId: p.item.id,
        holdId: hold.id,
        exclusive: p.item.kind !== "general_admission",
        quantity: p.quantity,
        admissions: p.admissions,
        unitPriceMinor: p.unitPriceMinor,
        state: "held" as const,
        expiresAt: hold.expiresAt,
      })),
    );

    await audit(tx, {
      clubId: event.clubId,
      actorType: "guest",
      action: "hold.created",
      entityType: "hold",
      entityId: hold.id,
      data: { totalMinor, admissions, lines: priced.length },
    });

    return { holdId: hold.id, expiresAt: hold.expiresAt, currency: hold.currency, totalMinor, admissions };
  });
}

/** Guest-facing view of a hold: basket lines, totals and expiry. No personal data. */
export async function getHoldSummary(holdId: string) {
  const [hold] = await db().select().from(holds).where(eq(holds.id, holdId));
  if (!hold) return null;
  const lines = await db()
    .select({
      allocationId: allocations.id,
      label: inventoryItems.label,
      kind: inventoryItems.kind,
      ticketTypeName: ticketTypes.name,
      quantity: allocations.quantity,
      admissions: allocations.admissions,
      unitPriceMinor: allocations.unitPriceMinor,
      state: allocations.state,
    })
    .from(allocations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, allocations.inventoryItemId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, inventoryItems.ticketTypeId))
    .where(eq(allocations.holdId, holdId))
    .orderBy(asc(inventoryItems.label));
  const [order] = await db().select({ id: orders.id, state: orders.state }).from(orders).where(eq(orders.holdId, holdId));
  const isExpired = hold.state === "expired" || (hold.state === "active" && hold.expiresAt.getTime() <= Date.now());
  return { hold, lines, order: order ?? null, isExpired };
}

/** Guest abandons their basket. Frees inventory immediately. */
export async function releaseHold(holdId: string) {
  return db().transaction(async (tx) => {
    const [h] = await tx.select().from(holds).where(eq(holds.id, holdId));
    if (!h) throw new AppError("not_found", "Hold not found");
    await lockEvent(tx, h.eventId);
    const [hold] = await tx.select().from(holds).where(eq(holds.id, holdId)).for("update");
    if (hold.state !== "active") return { released: false };
    const [order] = await tx.select().from(orders).where(eq(orders.holdId, holdId));
    if (order && order.state !== "pending_payment") return { released: false };
    await tx
      .update(allocations)
      .set({ state: "released", updatedAt: sql`now()` })
      .where(and(eq(allocations.holdId, holdId), eq(allocations.state, "held")));
    await tx.update(holds).set({ state: "released", updatedAt: sql`now()` }).where(eq(holds.id, holdId));
    if (order) await tx.update(orders).set({ state: "expired", updatedAt: sql`now()` }).where(eq(orders.id, order.id));
    await audit(tx, { clubId: hold.clubId, actorType: "guest", action: "hold.released", entityType: "hold", entityId: holdId });
    return { released: true };
  });
}
