/**
 * POST /api/holds/:holdId/checkout
 * Body: { buyerName, buyerEmail, buyerPhone?, whatsappOptIn }
 * Returns { orderPath, redirectUrl, bookingReference, state }.
 */
import { z } from "zod";
import { startCheckout } from "@/server/booking/checkout";
import { handle, jsonError, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { sendNotificationsAfterResponse } from "@/server/notifications/send-after-response";

export async function POST(req: Request, ctx: RouteContext<"/api/holds/[holdId]/checkout">) {
  const { holdId } = await ctx.params;
  if (!z.string().uuid().safeParse(holdId).success) return jsonError(404, "not_found", "Basket not found");
  const limited = await rateLimit(req, "checkout", 10, 60);
  if (limited) return limited;
  const body = await readJson(req);
  return handle(async () => {
    const result = await startCheckout(holdId, body);
    // Free bookings are confirmed immediately (paid ones confirm in the webhook).
    if (result.state === "confirmed") sendNotificationsAfterResponse(result.orderId);
    return result;
  });
}
