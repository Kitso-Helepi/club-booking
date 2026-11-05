/** Staff dashboard read model: which clubs and events can this user work on? */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { clubMemberships, clubs, eventStaffAssignments, events, venues } from "@/db/schema";

export async function getStaffEvents(userId: string) {
  const memberships = await db()
    .select({ clubId: clubs.id, clubName: clubs.name, role: clubMemberships.role })
    .from(clubMemberships)
    .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
    .where(eq(clubMemberships.userId, userId))
    .orderBy(asc(clubs.name));
  if (!memberships.length) return [];

  const assigned = await db()
    .select({ eventId: eventStaffAssignments.eventId })
    .from(eventStaffAssignments)
    .where(eq(eventStaffAssignments.userId, userId));
  const assignedIds = new Set(assigned.map((a) => a.eventId));

  const evs = await db()
    .select({ id: events.id, clubId: events.clubId, title: events.title, startsAt: events.startsAt, status: events.status, timezone: venues.timezone, venueName: venues.name })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(inArray(events.clubId, memberships.map((m) => m.clubId))))
    .orderBy(asc(events.startsAt));

  return memberships.map((m) => ({
    ...m,
    // Door staff only see events they are assigned to.
    events: evs.filter((e) => e.clubId === m.clubId && (m.role !== "door" || assignedIds.has(e.id))),
  }));
}
