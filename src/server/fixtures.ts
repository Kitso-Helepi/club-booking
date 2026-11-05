/**
 * SYNTHETIC fixture data: the fictional Velvet Fox club, venue "The Den" and one
 * sample event. Used by `npm run db:seed` and by integration tests.
 *
 * Insert-only: existing rows are never updated or deleted, so re-running the
 * seed cannot overwrite changes staff made in the app.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  clubMemberships,
  clubs,
  eventStaffAssignments,
  events,
  inventoryItems,
  layoutVersions,
  layouts,
  ticketTypes,
  user,
  venues,
} from "@/db/schema";
import { layoutGeometry, type LayoutGeometry } from "@/domain/layout";
import theDen from "../../fixtures/layouts/the-den.json";

export const PILOT_IDS = {
  club: "00000000-0000-4000-8000-000000000001",
  venue: "00000000-0000-4000-8000-000000000002",
  event: "00000000-0000-4000-8000-000000000003",
  layout: "00000000-0000-4000-8000-000000000004",
  layoutVersion: "00000000-0000-4000-8000-000000000005",
};

export const PILOT_TICKET_TYPES = [
  { key: "general", kind: "general_admission", name: "General admission", description: "Entry to the main floor.", priceMinor: 15000, admissionsPerUnit: 1 },
  { key: "balcony-seat", kind: "seat", name: "Balcony seat", description: "A reserved seat on the balcony. Includes entry.", priceMinor: 35000, admissionsPerUnit: 1 },
  { key: "vip-table-6", kind: "table", name: "VIP table for 6", description: "Exclusive table in the VIP Lounge. Includes 6 admissions.", priceMinor: 450000, admissionsPerUnit: 6 },
  { key: "table-4", kind: "table", name: "Lounge table for 4", description: "Exclusive lounge table. Includes 4 admissions.", priceMinor: 280000, admissionsPerUnit: 4 },
] as const;

/** Next Saturday 22:00 in Johannesburg (UTC+2, no DST) */
function nextSaturdayNight(): { startsAt: Date; endsAt: Date } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
  const daysToSat = (6 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysToSat);
  return { startsAt: d, endsAt: new Date(d.getTime() + 6 * 3600_000) };
}

export type FixtureOptions = {
  ids?: Partial<typeof PILOT_IDS>;
  clubSlug?: string;
  clubName?: string;
  eventSlug?: string;
  admissionCap?: number;
  gaCapacity?: number;
};

export async function ensureClubWithEvent(database: Db, opts: FixtureOptions = {}) {
  const ids = {
    club: opts.ids?.club ?? randomUUID(),
    venue: opts.ids?.venue ?? randomUUID(),
    event: opts.ids?.event ?? randomUUID(),
    layout: opts.ids?.layout ?? randomUUID(),
    layoutVersion: opts.ids?.layoutVersion ?? randomUUID(),
  };
  const geometry: LayoutGeometry = layoutGeometry.parse(theDen);
  const { startsAt, endsAt } = nextSaturdayNight();

  await database.transaction(async (tx) => {
    await tx
      .insert(clubs)
      .values({ id: ids.club, slug: opts.clubSlug ?? "velvet-fox", name: opts.clubName ?? "Velvet Fox Social Club", currency: "ZAR" })
      .onConflictDoNothing();
    await tx
      .insert(venues)
      .values({ id: ids.venue, clubId: ids.club, name: "The Den", address: "12 Example Lane, Braamfontein (fictional)", timezone: "Africa/Johannesburg" })
      .onConflictDoNothing();
    await tx
      .insert(events)
      .values({
        id: ids.event,
        clubId: ids.club,
        venueId: ids.venue,
        slug: opts.eventSlug ?? "midnight-frequencies",
        title: "Midnight Frequencies",
        description: "A night of deep house and amapiano with resident DJs. (Sample event: fictional.)",
        entryPolicy: "18+ with valid ID. No re-entry after 01:00. Dress code: smart casual. Tables must be claimed by 23:30.",
        startsAt,
        endsAt,
        status: "published",
        currency: "ZAR",
        admissionCap: opts.admissionCap ?? 200,
      })
      .onConflictDoNothing();

    await tx.insert(layouts).values({ id: ids.layout, clubId: ids.club, venueId: ids.venue, eventId: ids.event, name: "The Den - standard" }).onConflictDoNothing();
    await tx
      .insert(layoutVersions)
      .values({ id: ids.layoutVersion, clubId: ids.club, layoutId: ids.layout, version: 1, state: "published", geometry, publishedAt: sql`now()` })
      .onConflictDoNothing();
    await tx
      .update(events)
      .set({ publishedLayoutVersionId: ids.layoutVersion })
      .where(and(eq(events.id, ids.event), sql`${events.publishedLayoutVersionId} is null`));

    for (const t of PILOT_TICKET_TYPES) {
      await tx.insert(ticketTypes).values({ clubId: ids.club, eventId: ids.event, ...t }).onConflictDoNothing();
    }
    const types = await tx.select().from(ticketTypes).where(eq(ticketTypes.eventId, ids.event));
    const typeId = (key: string) => types.find((t) => t.key === key)!.id;

    for (const o of geometry.objects) {
      if (!o.bookable || !o.booking) continue;
      await tx
        .insert(inventoryItems)
        .values({
          clubId: ids.club,
          eventId: ids.event,
          ticketTypeId: typeId(o.booking.ticketTypeKey),
          kind: o.booking.mode === "seat" ? "seat" : "table",
          objectKey: o.key,
          zoneKey: o.zoneKey ?? null,
          label: o.label,
          capacity: 1,
        })
        .onConflictDoNothing();
    }
    // General admission pool (not on the map).
    const [ga] = await tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.eventId, ids.event), eq(inventoryItems.kind, "general_admission")));
    if (!ga) {
      await tx.insert(inventoryItems).values({
        clubId: ids.club,
        eventId: ids.event,
        ticketTypeId: typeId("general"),
        kind: "general_admission",
        label: "General admission",
        capacity: opts.gaCapacity ?? 120,
      });
    }
  });
  return ids;
}

/** Insert a staff user row WITHOUT a password (tests only; real staff use Better Auth). */
export async function insertBareUser(database: Db, email: string, name = email.split("@")[0]) {
  const id = randomUUID();
  await database.insert(user).values({ id, email, name, emailVerified: true });
  return id;
}

export async function addMembership(database: Db, clubId: string, userId: string, role: "owner" | "manager" | "door") {
  await database.insert(clubMemberships).values({ clubId, userId, role }).onConflictDoNothing();
}

export async function assignToEvent(database: Db, clubId: string, eventId: string, userId: string) {
  await database.insert(eventStaffAssignments).values({ clubId, eventId, userId }).onConflictDoNothing();
}
