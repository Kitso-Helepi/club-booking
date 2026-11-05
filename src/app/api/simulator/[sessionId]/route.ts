/**
 * POST /api/simulator/:sessionId  { outcome: "success" | "failure" | "duplicate" | "late_success" }
 * TEST MODE ONLY. Returns 403 when PAYMENTS_MODE=live.
 */
import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { runSimulatorOutcome } from "@/server/payments/simulator-actions";

const body = z.object({ outcome: z.enum(["success", "failure", "duplicate", "late_success"]) });

export async function POST(req: Request, ctx: RouteContext<"/api/simulator/[sessionId]">) {
  const { sessionId } = await ctx.params;
  const input = await readJson(req);
  return handle(async () => {
    const { outcome } = body.parse(input);
    const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    return runSimulatorOutcome(sessionId, outcome, baseUrl);
  });
}
