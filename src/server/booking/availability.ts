/**
 * Availability is computed from allocations, never from client state.
 * A held allocation only counts while its expires_at is in the future, so an
 * expired hold frees inventory immediately even if no cleanup job has run.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { allocations, events, inventoryItems, ticketTypes } from "@/db/schema";

/** SQL fragment: "this allocation currently takes inventory". */
export const activeAllocation = sql`(${allocations.state} = 'confirmed' OR (${allocations.state} = 'held' AND ${allocations.expiresAt} > now()))`;

export type ItemDisplayState = "available" | "held" | "sold" | "unavailable";

export type ItemAvailability = {
  id: string;
  kind: "general_admission" | "seat" | "table";
  label: string;
  objectKey: string | null;
  zoneKey: string | null;
  capacity: number;
  ticketTypeId: string;
  ticketTypeName: string;
  ticketTypeDescription: string;
  priceMinor: number;
  admissionsPerUnit: number;
  heldUnits: number;
  soldUnits: number;
  availableUnits: number;
  displayState: ItemDisplayState;
};

export async function getItemAvailability(tx: DbOrTx, eventId: string): Promise<ItemAvailability[]> {
  const rows = await tx
    .select({
      id: inventoryItems.id,
      kind: inventoryItems.kind,
      label: inventoryItems.label,
      objectKey: inventoryItems.objectKey,
      zoneKey: inventoryItems.zoneKey,
      capacity: inventoryItems.capacity,
      status: inventoryItems.status,
      ticketTypeId: ticketTypes.id,
      ticketTypeName: ticketTypes.name,
      ticketTypeDescription: ticketTypes.description,
      priceMinor: ticketTypes.priceMinor,
      admissionsPerUnit: ticketTypes.admissionsPerUnit,
      heldUnits: sql<number>`coalesce(sum(${allocations.quantity}) filter (where ${allocations.state} = 'held' and ${allocations.expiresAt} > now()), 0)::int`,
      soldUnits: sql<number>`coalesce(sum(${allocations.quantity}) filter (where ${allocations.state} = 'confirmed'), 0)::int`,
    })
    .from(inventoryItems)
    .innerJoin(ticketTypes, eq(ticketTypes.id, inventoryItems.ticketTypeId))
    .leftJoin(allocations, eq(allocations.inventoryItemId, inventoryItems.id))
    .where(and(eq(inventoryItems.eventId, eventId), sql`${inventoryItems.status} <> 'retired'`))
    .groupBy(inventoryItems.id, ticketTypes.id)
    .orderBy(asc(inventoryItems.kind), asc(inventoryItems.label));

  return rows.map((r) => {
    const availableUnits = r.status === "active" ? Math.max(0, r.capacity - r.heldUnits - r.soldUnits) : 0;
    let displayState: ItemDisplayState = "available";
    if (r.status !== "active") displayState = "unavailable";
    else if (availableUnits === 0) displayState = r.soldUnits >= r.capacity ? "sold" : "held";
    const { status: _status, ...rest } = r;
    void _status;
    return { ...rest, availableUnits, displayState };
  });
}

/** Admissions currently taken against the event's overall cap. */
export async function getAdmissionsUsed(tx: DbOrTx, eventId: string): Promise<number> {
  const [row] = await tx
    .select({ used: sql<number>`coalesce(sum(${allocations.admissions}), 0)::int` })
    .from(allocations)
    .where(and(eq(allocations.eventId, eventId), activeAllocation));
  return row?.used ?? 0;
}

export async function getEventCapacitySummary(tx: DbOrTx, eventId: string) {
  const [ev] = await tx.select({ cap: events.admissionCap }).from(events).where(eq(events.id, eventId));
  const used = await getAdmissionsUsed(tx, eventId);
  return { admissionCap: ev?.cap ?? 0, admissionsUsed: used, admissionsRemaining: Math.max(0, (ev?.cap ?? 0) - used) };
}
