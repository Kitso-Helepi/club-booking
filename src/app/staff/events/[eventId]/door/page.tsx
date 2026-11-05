import { redirect, notFound } from "next/navigation";
import { getStaffUser } from "@/server/auth";
import { db } from "@/db/client";
import { requireEventCapability } from "@/server/permissions";
import { isAppError } from "@/server/errors";
import { DoorScreen } from "@/components/staff/door-screen";
import { doorStats } from "@/server/checkin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Door" };

export default async function DoorPage(props: PageProps<"/staff/events/[eventId]/door">) {
  const user = await getStaffUser();
  if (!user) redirect("/staff/login");
  const { eventId } = await props.params;
  let access;
  try {
    access = await requireEventCapability(db(), user.id, eventId, "door.check_in");
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const stats = await doorStats(user.id, eventId);
  return <DoorScreen eventId={access.event.id} eventTitle={access.event.title} initialStats={stats} />;
}
