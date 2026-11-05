/**
 * What the simulator's checkout page can do. Test mode only.
 *
 * Each outcome sends a SIGNED event to our real webhook endpoint over HTTP,
 * just like a gateway would, so the full verification path runs.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { allocations, holds, orders, paymentAttempts } from "@/db/schema";
import { AppError } from "@/server/errors";
import { decryptToken } from "@/server/tokens";
import { assertSimulatorAllowed } from "./provider";
import { buildSimulatorEvent } from "./simulator";

export type SimulatorOutcome = "success" | "failure" | "duplicate" | "late_success";

export async function getSimulatorSession(sessionId: string) {
  assertSimulatorAllowed();
  const [row] = await db()
    .select({ attempt: paymentAttempts, order: orders })
    .from(paymentAttempts)
    .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
    .where(and(eq(paymentAttempts.provider, "simulator"), eq(paymentAttempts.providerSessionId, sessionId)));
  return row ?? null;
}

async function send(baseUrl: string, body: string, signature: string) {
  const res = await fetch(new URL("/api/payments/webhooks/simulator", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-simulator-signature": signature },
    body,
  });
  return (await res.json()) as { outcome?: string; error?: { message: string } };
}

export async function runSimulatorOutcome(sessionId: string, outcome: SimulatorOutcome, baseUrl: string) {
  const session = await getSimulatorSession(sessionId);
  if (!session) throw new AppError("not_found", "Unknown simulator session");
  const { attempt, order } = session;
  const base = {
    session_id: attempt.providerSessionId,
    merchant_id: attempt.merchantId,
    amount_minor: attempt.amountMinor,
    currency: attempt.currency,
  };
  const results: string[] = [];

  if (outcome === "late_success") {
    // Pretend the guest took too long: their hold's time runs out first.
    await db().update(holds).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(holds.id, order.holdId));
    await db()
      .update(allocations)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(and(eq(allocations.holdId, order.holdId), eq(allocations.state, "held")));
  }

  if (outcome === "failure") {
    const e = buildSimulatorEvent({ type: "payment.failed", ...base });
    results.push((await send(baseUrl, e.body, e.signature)).outcome ?? "error");
  } else {
    const e = buildSimulatorEvent({ type: "payment.succeeded", ...base });
    results.push((await send(baseUrl, e.body, e.signature)).outcome ?? "error");
    if (outcome === "duplicate") {
      // Exact same event delivered again, as gateways sometimes do.
      results.push((await send(baseUrl, e.body, e.signature)).outcome ?? "error");
    }
  }
  return { results, orderPath: `/o/${decryptToken(order.accessTokenEncrypted)}` };
}
