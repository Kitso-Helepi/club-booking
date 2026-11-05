/**
 * Publish a draft floor-plan version for an event.
 *
 * One transaction, same lock order as holds/confirmations: the event row is
 * locked FIRST, so a publish and a booking for the same event run one at a
 * time. Validation failures and refusals throw, which rolls everything back.
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { allocations, events, inventoryItems, layoutVersions, layouts, ticketTypes } from "@/db/schema";
import { validateLayout } from "@/domain/layout-validation";
import { layoutGeometry } from "@/domain/layout";
import { audit } from "@/server/audit";
import { activeAllocation } from "@/server/booking/availability";
import { lockEvent } from "@/server/booking/holds";
import { AppError } from "@/server/errors";
import { requireEventCapability } from "@/server/permissions";
import { diffInventory, type KeyedItem } from "./diff";

export type PublishResult = { versionId: string; created: number; updated: number; retired: number };

export async function publishLayoutVersion(
  database: Db,
  /** Pass `eventId` from routes: a draft of any other event is then refused. */
  input: { actorUserId: string; versionId: string; eventId?: string },
): Promise<PublishResult> {
  // Find the owning event without locking; everything is re-checked under the lock.
  const [owner] = await database
    .select({ eventId: layouts.eventId })
    .from(layoutVersions)
    .innerJoin(layouts, eq(layouts.id, layoutVersions.layoutId))
    .where(eq(layoutVersions.id, input.versionId));
  if (!owner) throw new AppError("not_found", "Not found");
  if (!owner.eventId) throw new AppError("conflict", "Only an event's own layout can be published");
  const eventId = owner.eventId;

  return database.transaction(async (tx) => {
    const { event } = await requireEventCapability(tx, input.actorUserId, eventId, "event.manage");
    if (input.eventId && input.eventId !== eventId) throw new AppError("conflict", "That layout belongs to a different event");
    await lockEvent(tx, eventId);

    const [version] = await tx.select().from(layoutVersions).where(eq(layoutVersions.id, input.versionId));
    if (!version || version.state !== "draft") throw new AppError("conflict", "Only a draft layout can be published");

    const types = await tx.select().from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
    const issues = validateLayout(version.geometry, types);
    if (issues.length > 0) throw new AppError("validation", "The layout has problems", { issues });
    const geometry = layoutGeometry.parse(version.geometry);
    const typeId = new Map(types.map((t) => [t.key, t.id]));

    const existing = (await tx
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.eventId, eventId), isNotNull(inventoryItems.objectKey)))
      .orderBy(asc(inventoryItems.id))) as (typeof inventoryItems.$inferSelect & { objectKey: string; kind: "seat" | "table" })[];
    const keyed: KeyedItem[] = existing.map((i) => ({
      id: i.id,
      objectKey: i.objectKey,
      kind: i.kind,
      ticketTypeId: i.ticketTypeId,
      zoneKey: i.zoneKey,
      label: i.label,
      status: i.status,
    }));
    const diff = diffInventory(keyed, geometry);

    // Refuse anything that would disturb live sales, before writing anything.
    const touchedIds = [...diff.retire.map((i) => i.id), ...diff.matched.map((m) => m.item.id)];
    const sold = new Set(
      touchedIds.length === 0
        ? []
        : (
            await tx
              .selectDistinct({ id: allocations.inventoryItemId })
              .from(allocations)
              .where(and(eq(allocations.eventId, eventId), inArray(allocations.inventoryItemId, touchedIds), activeAllocation))
          ).map((r) => r.id),
    );
    const removedWithSales = diff.retire.filter((i) => sold.has(i.id)).map((i) => i.objectKey).sort();
    if (removedWithSales.length > 0) {
      throw new AppError("conflict", "These tables or seats have bookings and cannot be removed", {
        keys: removedWithSales,
        needs: "reassignment",
      });
    }
    const typeById = new Map(types.map((t) => [t.id, t]));
    const changedWithSales = diff.matched
      .filter(({ item, desired }) => {
        if (!sold.has(item.id)) return false;
        const next = types.find((t) => t.key === desired.ticketTypeKey)!;
        return item.kind !== desired.kind || typeById.get(item.ticketTypeId)?.admissionsPerUnit !== next.admissionsPerUnit;
      })
      .map(({ item }) => item.objectKey)
      .sort();
    if (changedWithSales.length > 0) {
      throw new AppError("conflict", "These tables or seats have bookings, so their type or size cannot change", {
        keys: changedWithSales,
        reason: "change_with_sales",
      });
    }

    let created = 0;
    for (const d of diff.create) {
      await tx.insert(inventoryItems).values({
        clubId: event.clubId,
        eventId,
        ticketTypeId: typeId.get(d.ticketTypeKey)!,
        kind: d.kind,
        objectKey: d.objectKey,
        zoneKey: d.zoneKey,
        label: d.label,
        capacity: 1,
      });
      created++;
    }

    let updated = 0;
    for (const { item, desired } of [...diff.matched].sort((a, b) => a.item.id.localeCompare(b.item.id))) {
      const ticketTypeId = typeId.get(desired.ticketTypeKey)!;
      const reactivate = item.status === "retired";
      const changed =
        item.label !== desired.label ||
        item.zoneKey !== desired.zoneKey ||
        item.ticketTypeId !== ticketTypeId ||
        item.kind !== desired.kind ||
        reactivate;
      if (!changed) continue;
      await tx
        .update(inventoryItems)
        .set({
          label: desired.label,
          zoneKey: desired.zoneKey,
          ticketTypeId,
          kind: desired.kind,
          ...(reactivate ? { status: "active" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, item.id));
      updated++;
    }

    let retired = 0;
    for (const item of [...diff.retire].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.update(inventoryItems).set({ status: "retired", updatedAt: new Date() }).where(eq(inventoryItems.id, item.id));
      retired++;
    }

    await tx
      .update(layoutVersions)
      .set({ state: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(layoutVersions.state, "published"),
          inArray(layoutVersions.layoutId, tx.select({ id: layouts.id }).from(layouts).where(eq(layouts.eventId, eventId))),
        ),
      );
    await tx
      .update(layoutVersions)
      .set({ state: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(layoutVersions.id, version.id));
    await tx.update(events).set({ publishedLayoutVersionId: version.id }).where(eq(events.id, eventId));

    await audit(tx, {
      clubId: event.clubId,
      actorUserId: input.actorUserId,
      actorType: "staff",
      action: "layout.publish",
      entityType: "layout_version",
      entityId: version.id,
      data: { created, updated, retired },
    });

    return { versionId: version.id, created, updated, retired };
  });
}
