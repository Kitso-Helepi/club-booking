/**
 * Authorization. EVERY staff query and mutation goes through these helpers.
 * Hiding a button in the UI is not authorization.
 *
 * Roles (per club):
 *   owner   - everything in their club, including staff and settings
 *   manager - events, layouts, prices, orders, resends, cancellations
 *   door    - only events they are assigned to: scan, look up, admit
 *
 * A user with no membership in a club gets "not_found" for that club's records
 * (we do not even confirm the record exists).
 */
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { clubMemberships, eventStaffAssignments, events } from "@/db/schema";
import { AppError } from "./errors";

export type Role = "owner" | "manager" | "door";

export type Capability =
  | "club.manage" // club settings, venues, staff memberships
  | "club.view_audit"
  | "event.manage" // events, layouts, inventory, prices
  | "orders.view"
  | "orders.resend"
  | "orders.cancel"
  | "door.check_in"
  | "door.lookup";

const roleCapabilities: Record<Role, Capability[]> = {
  owner: ["club.manage", "club.view_audit", "event.manage", "orders.view", "orders.resend", "orders.cancel", "door.check_in", "door.lookup"],
  manager: ["event.manage", "orders.view", "orders.resend", "orders.cancel", "door.check_in", "door.lookup"],
  door: ["door.check_in", "door.lookup"],
};

export function roleCan(role: Role, cap: Capability) {
  return roleCapabilities[role].includes(cap);
}

export async function getMembership(tx: DbOrTx, userId: string, clubId: string) {
  const [m] = await tx
    .select()
    .from(clubMemberships)
    .where(and(eq(clubMemberships.userId, userId), eq(clubMemberships.clubId, clubId)));
  return m ?? null;
}

export async function requireClubCapability(tx: DbOrTx, userId: string, clubId: string, cap: Capability) {
  const m = await getMembership(tx, userId, clubId);
  if (!m) throw new AppError("not_found", "Not found");
  if (!roleCan(m.role, cap)) throw new AppError("forbidden", "You do not have permission to do that");
  return m;
}

/**
 * Event-scoped check. Door staff must also be assigned to the event.
 * Returns the event (always scoped to a club the user belongs to).
 */
export async function requireEventCapability(tx: DbOrTx, userId: string, eventId: string, cap: Capability) {
  const [ev] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!ev) throw new AppError("not_found", "Not found");
  const m = await requireClubCapability(tx, userId, ev.clubId, cap);
  if (m.role === "door") {
    const [a] = await tx
      .select({ id: eventStaffAssignments.id })
      .from(eventStaffAssignments)
      .where(and(eq(eventStaffAssignments.eventId, eventId), eq(eventStaffAssignments.userId, userId)));
    if (!a) throw new AppError("forbidden", "You are not assigned to this event");
  }
  return { event: ev, membership: m };
}
