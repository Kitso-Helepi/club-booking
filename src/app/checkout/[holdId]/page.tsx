import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clubs, events, venues } from "@/db/schema";
import { getHoldSummary } from "@/server/booking/holds";
import { formatMoney, formatVenueDateTime } from "@/lib/format";
import { CheckoutForm } from "@/components/guest/checkout-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout", referrer: "no-referrer" as const };

export default async function CheckoutPage(props: PageProps<"/checkout/[holdId]">) {
  const { holdId } = await props.params;
  if (!z.string().uuid().safeParse(holdId).success) notFound();
  const summary = await getHoldSummary(holdId);
  if (!summary) notFound();
  const { hold, lines, isExpired, order } = summary;
  const [ctx] = await db()
    .select({ event: events, venue: venues, club: clubs })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(clubs, eq(clubs.id, events.clubId))
    .where(eq(events.id, hold.eventId));
  const eventPath = `/c/${ctx.club.slug}/e/${ctx.event.slug}`;
  const admissions = lines.reduce((s, l) => s + l.admissions, 0);
  const unusable = isExpired || hold.state === "released" || (order && order.state !== "pending_payment");

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <Link href={eventPath} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← {ctx.event.title}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Your basket</h1>
      <p className="text-sm text-muted-foreground">
        {ctx.venue.name} · {formatVenueDateTime(ctx.event.startsAt, ctx.venue.timezone)}
      </p>

      <ul className="mt-5 divide-y rounded-lg border bg-card">
        {lines.map((l) => (
          <li key={l.allocationId} className="flex items-start justify-between gap-3 p-3">
            <div>
              <p className="font-medium">
                {l.kind === "general_admission" ? `${l.quantity} × ${l.ticketTypeName}` : `${l.label} · ${l.ticketTypeName}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {l.admissions} admission{l.admissions > 1 ? "s" : ""} · {l.admissions} individual pass{l.admissions > 1 ? "es" : ""}
              </p>
            </div>
            <p className="font-medium tabular-nums">{formatMoney(l.unitPriceMinor * l.quantity, hold.currency)}</p>
          </li>
        ))}
        <li className="flex items-center justify-between p-3">
          <p className="font-semibold">Total ({admissions} admissions)</p>
          <p className="text-lg font-bold tabular-nums">{formatMoney(hold.totalMinor, hold.currency)}</p>
        </li>
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Total includes all fees. No extra charges at checkout.</p>

      {unusable ? (
        <div role="alert" className="mt-6 rounded-lg border border-state-held/50 bg-state-held/10 p-4">
          <p className="font-semibold">This reservation has ended</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your items were released so other guests can book them. Nothing was charged.
          </p>
          <Link href={eventPath} className="mt-3 inline-block font-medium text-primary underline underline-offset-4">
            Choose again
          </Link>
        </div>
      ) : (
        <CheckoutForm
          holdId={hold.id}
          expiresAt={hold.expiresAt.toISOString()}
          eventPath={eventPath}
          isFree={hold.totalMinor === 0}
        />
      )}
    </main>
  );
}
