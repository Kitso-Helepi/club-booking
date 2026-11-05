import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";
import { getPublicEvent } from "@/server/events";
import { formatVenueDateTime, formatVenueTime } from "@/lib/format";
import { EventBooking } from "@/components/guest/event-booking";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/c/[clubSlug]/e/[eventSlug]">): Promise<Metadata> {
  const { clubSlug, eventSlug } = await props.params;
  const data = await getPublicEvent(clubSlug, eventSlug);
  return { title: data ? `${data.event.title} at ${data.venue.name}` : "Event not found" };
}

export default async function EventPage(props: PageProps<"/c/[clubSlug]/e/[eventSlug]">) {
  const { clubSlug, eventSlug } = await props.params;
  const data = await getPublicEvent(clubSlug, eventSlug);
  if (!data) notFound();
  const { event, venue, club, items, geometry, capacity } = data;
  const tz = venue.timezone;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-40 pt-6">
      <p className="text-sm font-medium uppercase tracking-widest text-primary">{club.name}</p>
      <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">{event.title}</h1>
      <p className="mt-3 text-muted-foreground">{event.description}</p>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex gap-3 rounded-lg border bg-card p-3">
          <CalendarDays aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <dt className="sr-only">Date and time</dt>
            <dd className="font-medium">{formatVenueDateTime(event.startsAt, tz)}</dd>
            <dd className="text-muted-foreground">
              Until {formatVenueTime(event.endsAt, tz)} · times shown in venue time ({tz})
            </dd>
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border bg-card p-3">
          <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <dt className="sr-only">Venue</dt>
            <dd className="font-medium">{venue.name}</dd>
            <dd className="text-muted-foreground">{venue.address}</dd>
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border bg-card p-3 sm:col-span-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <dt className="font-medium">Entry policy</dt>
            <dd className="text-muted-foreground">{event.entryPolicy}</dd>
          </div>
        </div>
      </dl>

      <EventBooking
        eventId={event.id}
        currency={event.currency}
        items={items}
        geometry={geometry}
        admissionsRemaining={capacity.admissionsRemaining}
      />
    </main>
  );
}
