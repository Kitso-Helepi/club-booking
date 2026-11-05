import Link from "next/link";
import { redirect } from "next/navigation";
import { DoorOpen, Receipt } from "lucide-react";
import { getStaffUser } from "@/server/auth";
import { getStaffEvents } from "@/server/staff";
import { roleCan } from "@/server/permissions";
import { formatVenueDateTime } from "@/lib/format";
import { SignOutButton } from "@/components/staff/sign-out-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff" };

export default async function StaffHome() {
  const user = await getStaffUser();
  if (!user) redirect("/staff/login");
  const clubs = await getStaffEvents(user.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Choose an event</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <SignOutButton />
      </div>

      {clubs.length === 0 && (
        <p className="mt-8 rounded-lg border bg-card p-4 text-sm">You are not a member of any club yet. Ask a club owner to add you.</p>
      )}

      {clubs.map((c) => (
        <section key={c.clubId} className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-widest text-primary">
            {c.clubName} · {c.role}
          </h2>
          {c.events.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No events assigned to you.</p>}
          <ul className="mt-2 space-y-3">
            {c.events.map((e) => (
              <li key={e.id} className="rounded-lg border bg-card p-4">
                <p className="font-semibold">{e.title}</p>
                <p className="text-sm text-muted-foreground">
                  {e.venueName} · {formatVenueDateTime(e.startsAt, e.timezone)} · {e.status}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link href={`/staff/events/${e.id}/door`} className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground">
                    <DoorOpen aria-hidden className="size-5" /> Door
                  </Link>
                  {roleCan(c.role, "orders.view") && (
                    <Link href={`/staff/events/${e.id}/orders`} className="flex min-h-12 items-center justify-center gap-2 rounded-md border font-semibold">
                      <Receipt aria-hidden className="size-5" /> Orders
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
