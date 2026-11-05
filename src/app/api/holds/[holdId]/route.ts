/** DELETE /api/holds/:holdId - guest gives back their reserved items. */
import { z } from "zod";
import { releaseHold } from "@/server/booking/holds";
import { handle, jsonError } from "@/server/http";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/holds/[holdId]">) {
  const { holdId } = await ctx.params;
  if (!z.string().uuid().safeParse(holdId).success) return jsonError(404, "not_found", "Basket not found");
  return handle(() => releaseHold(holdId));
}
