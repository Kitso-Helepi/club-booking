import { notFound } from "next/navigation";
import { getPassByToken } from "@/server/orders";
import { passQrSvg } from "@/server/qr";
import { formatVenueDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guest pass", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

/** One guest's pass. Shows nothing about the buyer or the other passes in the booking. */
export default async function PassPage(props: PageProps<"/p/[token]">) {
  const { token } = await props.params;
  const pass = await getPassByToken(token);
  if (!pass) notFound();
  const qr = pass.state === "valid" ? await passQrSvg(token) : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center px-4 py-8 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-primary">{pass.clubName}</p>
      <h1 className="mt-1 text-2xl font-bold">{pass.eventTitle}</h1>
      <p className="text-sm text-muted-foreground">
        {pass.venueName} · {formatVenueDateTime(pass.startsAt, pass.timezone)}
      </p>
      <p className="mt-6 text-lg font-semibold">{pass.label}</p>

      {qr ? (
        <div
          className="mt-4 w-full max-w-72 overflow-hidden rounded-xl bg-white p-2"
          role="img"
          aria-label="Entry QR code. Turn your screen brightness up at the door."
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      ) : (
        <div role="alert" className="mt-4 w-full rounded-xl border border-destructive/50 bg-destructive/10 p-6 font-semibold">
          This pass has been cancelled and will not be accepted.
        </div>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        {pass.admittedAt ? `Checked in at ${formatVenueDateTime(pass.admittedAt, pass.timezone)}` : "Show this code at the door. One entry per pass."}
      </p>
      <p className="mt-6 text-xs text-muted-foreground">{pass.entryPolicy}</p>
      <p className="mt-2 text-xs text-muted-foreground">{pass.venueAddress}</p>
    </main>
  );
}
