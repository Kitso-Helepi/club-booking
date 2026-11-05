import Link from "next/link";

const appName = process.env.APP_NAME ?? "Club Booking";

/** Pilot landing page. Public multi-club discovery is out of scope for the pilot. */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-12">
      <p className="text-sm font-medium uppercase tracking-widest text-primary">Staging pilot</p>
      <h1 className="mt-2 text-4xl font-bold">{appName}</h1>
      <p className="mt-3 text-muted-foreground">
        Book tables, seats and entry for club nights. This pilot runs one fictional club with simulated payments.
      </p>
      <div className="mt-8 grid gap-3">
        <Link href="/c/velvet-fox/e/midnight-frequencies" className="flex min-h-14 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground">
          Open the sample event
        </Link>
        <Link href="/staff" className="flex min-h-14 items-center justify-center rounded-lg border text-lg font-semibold">
          Staff sign in
        </Link>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">All club, venue and event data here is synthetic.</p>
    </main>
  );
}
