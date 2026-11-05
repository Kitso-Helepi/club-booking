/**
 * Read models for guests (by secret token) and staff (by club scope).
 */
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { clubs, events, orderLines, orders, passes, venues } from "@/db/schema";
import { decryptToken, hashToken, looksLikeToken } from "./tokens";
import { requireEventCapability } from "./permissions";

/** Private buyer view. Only someone holding the order token gets here. */
export async function getOrderByToken(token: string) {
  if (!looksLikeToken(token)) return null;
  const [row] = await db()
    .select({ order: orders, event: events, venue: venues, club: clubs })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(clubs, eq(clubs.id, orders.clubId))
    .where(eq(orders.accessTokenHash, hashToken(token)));
  if (!row) return null;
  const lines = await db().select().from(orderLines).where(eq(orderLines.orderId, row.order.id));
  const ps = await db()
    .select()
    .from(passes)
    .where(eq(passes.orderId, row.order.id))
    .orderBy(asc(passes.label), asc(passes.sequence));
  return {
    ...row,
    lines,
    passes: ps.map((p) => ({
      id: p.id,
      label: p.label,
      state: p.state,
      admittedAt: p.admittedAt,
      token: decryptToken(p.tokenEncrypted),
    })),
  };
}

/** Single pass view. Shows nothing about the buyer or the other passes. */
export async function getPassByToken(token: string) {
  if (!looksLikeToken(token)) return null;
  const [row] = await db()
    .select({
      id: passes.id,
      label: passes.label,
      state: passes.state,
      admittedAt: passes.admittedAt,
      eventTitle: events.title,
      startsAt: events.startsAt,
      entryPolicy: events.entryPolicy,
      venueName: venues.name,
      venueAddress: venues.address,
      timezone: venues.timezone,
      clubName: clubs.name,
    })
    .from(passes)
    .innerJoin(events, eq(events.id, passes.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(clubs, eq(clubs.id, passes.clubId))
    .where(eq(passes.tokenHash, hashToken(token)));
  return row ?? null;
}

/** Staff order search, always scoped to the event's club. */
export async function searchOrders(userId: string, eventId: string, q: string) {
  const { event } = await requireEventCapability(db(), userId, eventId, "orders.view");
  const term = q.trim();
  const where = term
    ? and(eq(orders.clubId, event.clubId), eq(orders.eventId, eventId), ilike(orders.bookingReference, `%${term.replace(/[%_]/g, "")}%`))
    : and(eq(orders.clubId, event.clubId), eq(orders.eventId, eventId));
  return db()
    .select({
      id: orders.id,
      bookingReference: orders.bookingReference,
      state: orders.state,
      buyerName: orders.buyerName,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(50);
}
