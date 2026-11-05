/** GET /api/staff/events/:eventId/lookup?q=CB-XXXX  - door manual lookup by booking reference. */
import { requireStaffUser } from "@/server/auth";
import { doorStats, lookupBooking } from "@/server/checkin";
import { handle } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/staff/events/[eventId]/lookup">) {
  const { eventId } = await ctx.params;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return handle(async () => {
    const staff = await requireStaffUser();
    const [results, stats] = await Promise.all([lookupBooking(staff.id, eventId, q), doorStats(staff.id, eventId)]);
    return { results, stats };
  });
}
