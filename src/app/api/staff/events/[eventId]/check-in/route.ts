/**
 * POST /api/staff/events/:eventId/check-in
 * Body: { token } (scanned QR / typed code) or { passId } (manual selection).
 * Requires a signed-in staff member allowed to check in at this event.
 */
import { requireStaffUser } from "@/server/auth";
import { checkIn } from "@/server/checkin";
import { handle, readJson } from "@/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/staff/events/[eventId]/check-in">) {
  const { eventId } = await ctx.params;
  const body = await readJson(req);
  return handle(async () => {
    const staff = await requireStaffUser();
    return checkIn(staff.id, eventId, body);
  });
}
