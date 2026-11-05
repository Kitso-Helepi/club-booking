/** GET /api/orders/:token/status - polled by the order page while payment is processing. */
import { NextResponse } from "next/server";
import { getOrderByToken } from "@/server/orders";

export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[token]/status">) {
  const { token } = await ctx.params;
  const o = await getOrderByToken(token);
  if (!o) return NextResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  return NextResponse.json(
    { state: o.order.state, passes: o.passes.length },
    { headers: { "cache-control": "no-store" } },
  );
}
