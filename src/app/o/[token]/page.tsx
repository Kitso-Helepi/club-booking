import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrderByToken } from "@/server/orders";
import { passQrSvg, passUrl } from "@/server/qr";
import { formatMoney, formatVenueDateTime } from "@/lib/format";
import { OrderStatusPoller } from "@/components/guest/order-status-poller";
import { SharePass } from "@/components/guest/share-pass";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your booking", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

/** PRIVATE buyer page. Reachable only with the secret link token. */
export default async function OrderPage(props: PageProps<"/o/[token]">) {
  const { token } = await props.params;
  const data = await getOrderByToken(token);
  if (!data) notFound();
  const { order, event, venue, club, lines, passes } = data;
  const tz = venue.timezone;
  const qrs = order.state === "confirmed" ? await Promise.all(passes.map((p) => passQrSvg(p.token))) : [];

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <p className="text-sm font-medium uppercase tracking-widest text-primary">{club.name}</p>
      <h1 className="mt-1 text-2xl font-bold">{event.title}</h1>
      <p className="text-sm text-muted-foreground">
        {venue.name} · {formatVenueDateTime(event.startsAt, tz)}
      </p>

      <div className="mt-4 rounded-lg border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Booking reference</p>
        <p className="font-mono text-2xl font-bold tracking-wider">{order.bookingReference}</p>
        <p className="mt-1 text-xs text-muted-foreground">Quote this if you contact the club. It does not give access to your booking.</p>
      </div>

      <StatusBlock state={order.state} />
      {order.state === "pending_payment" && <OrderStatusPoller token={token} />}

      <ul className="mt-4 divide-y rounded-lg border bg-card text-sm">
        {lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-3 p-3">
            <span>
              {l.quantity > 1 ? `${l.quantity} × ` : ""}
              {l.label} · {l.admissions} admission{l.admissions > 1 ? "s" : ""}
            </span>
            <span className="tabular-nums">{formatMoney(l.lineTotalMinor, order.currency)}</span>
          </li>
        ))}
        <li className="flex justify-between p-3 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(order.totalMinor, order.currency)}</span>
        </li>
      </ul>

      {order.state === "confirmed" && (
        <section aria-labelledby="passes" className="mt-8">
          <h2 id="passes" className="text-xl font-semibold">
            {passes.length} guest pass{passes.length === 1 ? "" : "es"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every guest needs their own pass. Share one pass per person; sharing a pass never reveals the others or
            your contact details. Keep this page private.
          </p>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
            {passes.map((p, i) => (
              <li key={p.id} className="rounded-xl border bg-card p-4">
                <p className="font-semibold">{p.label}</p>
                <p className="text-xs text-muted-foreground">
                  {p.state === "cancelled" ? "Cancelled" : p.admittedAt ? `Checked in ${formatVenueDateTime(p.admittedAt, tz)}` : "Not yet checked in"}
                </p>
                <div
                  className="mx-auto mt-3 w-44 overflow-hidden rounded-md bg-white"
                  role="img"
                  aria-label={`QR code for ${p.label}`}
                  dangerouslySetInnerHTML={{ __html: qrs[i] }}
                />
                <SharePass url={passUrl(p.token)} label={p.label} eventTitle={event.title} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        <Link href={`/c/${club.slug}/e/${event.slug}`} className="underline underline-offset-4">
          Event page
        </Link>
      </p>
    </main>
  );
}

function StatusBlock({ state }: { state: string }) {
  const map: Record<string, { title: string; body: string; tone: string }> = {
    pending_payment: { title: "Waiting for payment confirmation…", body: "This usually takes a few seconds. Your passes appear here once the payment provider confirms. Do not pay twice.", tone: "border-state-held/50 bg-state-held/10" },
    confirmed: { title: "Booking confirmed", body: "A confirmation email is on its way.", tone: "border-state-available/50 bg-state-available/10" },
    payment_failed: { title: "Payment failed", body: "Nothing was charged and your items were released. You can book again from the event page.", tone: "border-destructive/50 bg-destructive/10" },
    expired: { title: "Reservation expired", body: "Your reservation time ran out before payment was confirmed. Nothing was charged.", tone: "border-destructive/50 bg-destructive/10" },
    cancelled: { title: "Booking cancelled", body: "This booking was cancelled and its passes no longer work.", tone: "border-destructive/50 bg-destructive/10" },
    needs_reconciliation: { title: "Payment received, but your items were no longer available", body: "Your reservation expired before the payment arrived and the items were booked by someone else. No passes were issued. The club has been alerted and will contact you about a refund or alternative.", tone: "border-state-held/50 bg-state-held/10" },
  };
  const s = map[state] ?? map.pending_payment;
  return (
    <div role="status" className={`mt-4 rounded-lg border p-4 ${s.tone}`}>
      <p className="font-semibold">{s.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
    </div>
  );
}
