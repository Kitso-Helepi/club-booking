/**
 * Order confirmation. Runs inside the caller's transaction so that
 * finalising allocations, issuing passes and creating notification jobs
 * succeed or fail TOGETHER.
 *
 * Idempotency: passes are unique on (allocation_id, sequence) and initial
 * confirmation jobs are unique on (order_id, channel), and both inserts use
 * ON CONFLICT DO NOTHING. Running confirmation twice cannot create extras.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { allocations, holds, inventoryItems, notificationJobs, orders, passes, ticketTypes } from "@/db/schema";
import { audit } from "@/server/audit";
import { encryptToken, hashToken, newToken } from "@/server/tokens";

type OrderRow = typeof orders.$inferSelect;

function passLabel(kind: string, itemLabel: string, ticketTypeName: string, i: number, n: number) {
  if (kind === "table") return `${itemLabel} · Guest ${i} of ${n}`;
  if (kind === "seat") return `${itemLabel}`;
  return n > 1 ? `${ticketTypeName} · ${i} of ${n}` : ticketTypeName;
}

export async function confirmOrderInTx(tx: Tx, order: OrderRow, actor: { type: "provider" | "system" | "guest" }) {
  await tx
    .update(allocations)
    .set({ state: "confirmed", expiresAt: null, updatedAt: sql`now()` })
    .where(eq(allocations.orderId, order.id));
  await tx.update(holds).set({ state: "converted", updatedAt: sql`now()` }).where(eq(holds.id, order.holdId));
  await tx
    .update(orders)
    .set({ state: "confirmed", confirmedAt: sql`coalesce(${orders.confirmedAt}, now())`, updatedAt: sql`now()` })
    .where(eq(orders.id, order.id));

  const allocs = await tx
    .select({
      id: allocations.id,
      admissions: allocations.admissions,
      kind: inventoryItems.kind,
      label: inventoryItems.label,
      ticketTypeName: ticketTypes.name,
    })
    .from(allocations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, allocations.inventoryItemId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, inventoryItems.ticketTypeId))
    .where(eq(allocations.orderId, order.id))
    .orderBy(asc(inventoryItems.label));

  const passRows = allocs.flatMap((a) =>
    Array.from({ length: a.admissions }, (_, idx) => {
      const token = newToken();
      return {
        clubId: order.clubId,
        eventId: order.eventId,
        orderId: order.id,
        allocationId: a.id,
        sequence: idx + 1,
        label: passLabel(a.kind, a.label, a.ticketTypeName, idx + 1, a.admissions),
        tokenHash: hashToken(token),
        tokenEncrypted: encryptToken(token),
      };
    }),
  );
  let issued = 0;
  if (passRows.length) {
    const inserted = await tx
      .insert(passes)
      .values(passRows)
      .onConflictDoNothing({ target: [passes.allocationId, passes.sequence] })
      .returning({ id: passes.id });
    issued = inserted.length;
  }

  const channels: ("email" | "whatsapp")[] = ["email"];
  if (order.whatsappOptIn && process.env.WHATSAPP_AUTOMATION_ENABLED === "true") channels.push("whatsapp");
  await tx
    .insert(notificationJobs)
    .values(channels.map((channel) => ({ clubId: order.clubId, orderId: order.id, channel, kind: "initial_confirmation" as const })))
    .onConflictDoNothing({
      target: [notificationJobs.orderId, notificationJobs.channel],
      where: sql`${notificationJobs.kind} = 'initial_confirmation'`,
    });

  await audit(tx, {
    clubId: order.clubId,
    actorType: actor.type,
    action: "order.confirmed",
    entityType: "order",
    entityId: order.id,
    data: { passesIssued: issued, totalMinor: order.totalMinor },
  });
  return { passesIssued: issued };
}

export async function countPasses(tx: Tx, orderId: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(passes)
    .where(and(eq(passes.orderId, orderId)));
  return r.n;
}
