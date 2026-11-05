/**
 * Door check-in.
 *
 * Admission is ONE conditional UPDATE:
 *   UPDATE passes SET admitted_at = now() WHERE id = ? AND admitted_at IS NULL AND state = 'valid'
 * If two phones scan the same pass at the same moment, Postgres lets exactly
 * one of them change the row; the other sees zero rows and reports "already used"
 * with the original time. A partial unique index on check_in_records backs this up.
 */
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { checkInRecords, inventoryItems, allocations, orders, passes } from "@/db/schema";
import { requireEventCapability } from "./permissions";
import { hashToken, looksLikeToken } from "./tokens";

export type CheckInResult = "admitted" | "already_used" | "cancelled" | "wrong_event" | "invalid";

export type CheckInResponse = {
  result: CheckInResult;
  pass?: {
    id: string;
    label: string;
    bookingReference: string;
    admittedAt: string | null;
  };
  /** For table bookings: how many of the group are in. */
  group?: { label: string; admitted: number; total: number };
};

export const checkInInput = z.union([
  z.object({ token: z.string().trim().min(1).max(512) }),
  z.object({ passId: z.string().uuid() }),
]);

/** QR codes contain a pass URL (…/p/<token>) or the bare token. Accept both. */
export function extractToken(scanned: string): string {
  const s = scanned.trim();
  const m = s.match(/\/p\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/);
  return m ? m[1] : s;
}

async function groupCounts(allocationId: string) {
  const [g] = await db()
    .select({
      label: inventoryItems.label,
      kind: inventoryItems.kind,
      total: sql<number>`count(${passes.id}) filter (where ${passes.state} = 'valid')::int`,
      admitted: sql<number>`count(${passes.id}) filter (where ${passes.admittedAt} is not null)::int`,
    })
    .from(passes)
    .innerJoin(allocations, eq(allocations.id, passes.allocationId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, allocations.inventoryItemId))
    .where(eq(passes.allocationId, allocationId))
    .groupBy(inventoryItems.label, inventoryItems.kind);
  return g && g.total > 1 ? { label: g.label, admitted: g.admitted, total: g.total } : undefined;
}

export async function checkIn(
  operatorUserId: string,
  eventId: string,
  rawInput: unknown,
): Promise<CheckInResponse> {
  const input = checkInInput.parse(rawInput);
  const { event } = await requireEventCapability(db(), operatorUserId, eventId, "door.check_in");
  const method = "token" in input ? ("scan" as const) : ("manual" as const);

  const record = (result: CheckInResult, passId: string | null) =>
    db().insert(checkInRecords).values({ clubId: event.clubId, eventId, passId, operatorUserId, result, method });

  let pass: typeof passes.$inferSelect | undefined;
  if ("token" in input) {
    const token = extractToken(input.token);
    if (looksLikeToken(token)) {
      [pass] = await db().select().from(passes).where(eq(passes.tokenHash, hashToken(token)));
    }
  } else {
    [pass] = await db().select().from(passes).where(eq(passes.id, input.passId));
  }

  // Unknown pass, or a pass from ANOTHER club: never reveal anything about it.
  if (!pass || pass.clubId !== event.clubId) {
    await record("invalid", null);
    return { result: "invalid" };
  }
  const [order] = await db().select({ ref: orders.bookingReference }).from(orders).where(eq(orders.id, pass.orderId));
  const view = (p: typeof pass) => ({
    id: p.id,
    label: p.label,
    bookingReference: order.ref,
    admittedAt: p.admittedAt ? p.admittedAt.toISOString() : null,
  });

  if (pass.eventId !== eventId) {
    await record("wrong_event", pass.id);
    return { result: "wrong_event", pass: { ...view(pass), admittedAt: null } };
  }
  if (pass.state === "cancelled") {
    await record("cancelled", pass.id);
    return { result: "cancelled", pass: view(pass), group: await groupCounts(pass.allocationId) };
  }

  const admitted = await db().transaction(async (tx) => {
    const rows = await tx
      .update(passes)
      .set({ admittedAt: sql`now()`, admittedBy: operatorUserId })
      .where(and(eq(passes.id, pass!.id), sql`${passes.admittedAt} is null`, eq(passes.state, "valid")))
      .returning();
    if (rows.length === 1) {
      await tx.insert(checkInRecords).values({ clubId: event.clubId, eventId, passId: pass!.id, operatorUserId, result: "admitted", method });
    }
    return rows[0];
  });

  if (admitted) {
    return { result: "admitted", pass: view(admitted), group: await groupCounts(admitted.allocationId) };
  }

  // Lost the race or a repeat scan: report the ORIGINAL admission.
  const [current] = await db().select().from(passes).where(eq(passes.id, pass.id));
  const result: CheckInResult = current.state === "cancelled" ? "cancelled" : "already_used";
  await record(result, pass.id);
  return { result, pass: view(current), group: await groupCounts(current.allocationId) };
}

/** Manual lookup by booking reference (or its tail) for an event. */
export async function lookupBooking(operatorUserId: string, eventId: string, query: string) {
  const { event } = await requireEventCapability(db(), operatorUserId, eventId, "door.lookup");
  const q = query.trim().toUpperCase();
  if (q.length < 4) return [];
  const found = await db()
    .select({ id: orders.id, ref: orders.bookingReference, state: orders.state, buyerName: orders.buyerName })
    .from(orders)
    .where(
      and(
        eq(orders.clubId, event.clubId),
        eq(orders.eventId, eventId),
        or(eq(orders.bookingReference, q), ilike(orders.bookingReference, `%${q.replace(/[%_]/g, "")}`)),
      ),
    )
    .limit(5);
  const results = [];
  for (const o of found) {
    const ps = await db()
      .select({ id: passes.id, label: passes.label, state: passes.state, admittedAt: passes.admittedAt })
      .from(passes)
      .where(eq(passes.orderId, o.id))
      .orderBy(asc(passes.label), asc(passes.sequence));
    // Door staff see first name + initial only.
    const [first, ...rest] = o.buyerName.split(/\s+/);
    const shortName = rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
    results.push({ orderId: o.id, bookingReference: o.ref, state: o.state, buyerName: shortName, passes: ps });
  }
  return results;
}

export async function doorStats(operatorUserId: string, eventId: string) {
  const { event } = await requireEventCapability(db(), operatorUserId, eventId, "door.lookup");
  const [s] = await db()
    .select({
      issued: sql<number>`count(*) filter (where ${passes.state} = 'valid')::int`,
      admitted: sql<number>`count(*) filter (where ${passes.admittedAt} is not null and ${passes.state} = 'valid')::int`,
    })
    .from(passes)
    .where(and(eq(passes.eventId, eventId), eq(passes.clubId, event.clubId)));
  return { issued: s.issued, admitted: s.admitted, admissionCap: event.admissionCap };
}
