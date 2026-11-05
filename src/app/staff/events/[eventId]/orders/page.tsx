import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaffUser } from "@/server/auth";
import { searchOrders } from "@/server/orders";
import { isAppError } from "@/server/errors";
import { formatMoney } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

export default async function OrdersPage(props: PageProps<"/staff/events/[eventId]/orders">) {
  const user = await getStaffUser();
  if (!user) redirect("/staff/login");
  const { eventId } = await props.params;
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  let rows;
  try {
    rows = await searchOrders(user.id, eventId, q);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href="/staff" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Events
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Orders</h1>
      <form className="mt-4 flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Booking reference" aria-label="Booking reference" className="h-11" />
        <Button type="submit" className="h-11">
          Search
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No orders yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-3">Reference</th>
                <th className="p-3">Buyer</th>
                <th className="p-3">State</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="p-3 font-mono">{o.bookingReference}</td>
                  <td className="p-3">{o.buyerName}</td>
                  <td className="p-3">{o.state.replace(/_/g, " ")}</td>
                  <td className="p-3 text-right tabular-nums">{formatMoney(o.totalMinor, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Order detail, resend and cancellation screens are planned (workstreams D and E). Not built yet.
      </p>
    </main>
  );
}
