/**
 * POST /api/holds
 * Body: { eventId, items: [{ inventoryItemId, quantity }] }
 * Reserves the whole basket for HOLD_MINUTES or fails with 409.
 */
import { createHold } from "@/server/booking/holds";
import { handle, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "holds", 20, 60);
  if (limited) return limited;
  const body = await readJson(req);
  return handle(() => createHold(body), { status: 201 });
}
