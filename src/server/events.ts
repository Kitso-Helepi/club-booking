/** Public (guest) event read model. Only published events are visible. */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clubs, events, layoutVersions, venues } from "@/db/schema";
import { layoutGeometry, type LayoutGeometry } from "@/domain/layout";
import { getEventCapacitySummary, getItemAvailability } from "./booking/availability";

export async function getPublicEvent(clubSlug: string, eventSlug: string) {
  const [row] = await db()
    .select({ event: events, venue: venues, club: clubs })
    .from(events)
    .innerJoin(clubs, eq(clubs.id, events.clubId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(clubs.slug, clubSlug), eq(events.slug, eventSlug), eq(events.status, "published")));
  if (!row) return null;

  let geometry: LayoutGeometry | null = null;
  if (row.event.publishedLayoutVersionId) {
    const [lv] = await db()
      .select({ geometry: layoutVersions.geometry })
      .from(layoutVersions)
      .where(eq(layoutVersions.id, row.event.publishedLayoutVersionId));
    const parsed = layoutGeometry.safeParse(lv?.geometry);
    geometry = parsed.success ? parsed.data : null;
  }
  const [items, capacity] = await Promise.all([getItemAvailability(db(), row.event.id), getEventCapacitySummary(db(), row.event.id)]);
  return { ...row, geometry, items, capacity };
}

export type PublicEvent = NonNullable<Awaited<ReturnType<typeof getPublicEvent>>>;
