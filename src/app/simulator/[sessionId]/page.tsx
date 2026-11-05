import { notFound } from "next/navigation";
import { getSimulatorSession } from "@/server/payments/simulator-actions";
import { formatMoney } from "@/lib/format";
import { SimulatorControls } from "@/components/guest/simulator-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment simulator", referrer: "no-referrer" as const };

/** Stands in for a hosted payment page. Unreachable in live mode. */
export default async function SimulatorPage(props: PageProps<"/simulator/[sessionId]">) {
  if ((process.env.PAYMENTS_MODE ?? "test") !== "test") notFound();
  const { sessionId } = await props.params;
  const session = await getSimulatorSession(sessionId);
  if (!session) notFound();
  const { attempt, order } = session;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <div className="rounded-lg border-2 border-dashed border-state-held p-3 text-center text-sm font-bold uppercase tracking-wide text-state-held">
        Payment simulator · test mode · no money moves
      </div>
      <h1 className="mt-6 text-2xl font-bold">Pay {formatMoney(attempt.amountMinor, attempt.currency)}</h1>
      <p className="text-sm text-muted-foreground">
        Booking {order.bookingReference} · merchant {attempt.merchantId.slice(0, 22)}…
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        In production this page is the payment provider&apos;s hosted checkout. Choose what the &quot;provider&quot;
        reports back. Each choice sends a signed webhook to the app.
      </p>
      <SimulatorControls sessionId={sessionId} />
    </main>
  );
}
