/**
 * Publish a draft floor-plan version for an event.
 *
 * One transaction, same lock order as holds/confirmations: the event row is
 * locked FIRST, so a publish and a booking for the same event run one at a
 * time. Validation failures and refusals throw, which rolls everything back.
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, inventoryItems, layoutVersions, layouts, ticketTypes } from "@/db/schema";
import { validateLayout } from "@/domain/layout-validation";
import { layoutGeometry } from "@/domain/layout";
import { audit } from "@/server/audit";
import { lockEvent } from "@/server/booking/holds";
import { AppError } from "@/server/errors";
import { requireEventCapability } from "@/server/permissions";
import { diffInventory, type KeyedItem } from "./diff";

export type PublishResult = { versionId: string; created: number; updated: number; retired: number };

export async function publishLayoutVersion(
  database: Db,
  input: { actorUserId: string; versionId: string },
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
        item.label !== desired.label || item.zoneKey !== desired.zoneKey || item.ticketTypeId !== ticketTypeId || reactivate;
      if (!changed) continue;
      await tx
        .update(inventoryItems)
        .set({
          label: desired.label,
          zoneKey: desired.zoneKey,
          ticketTypeId,
          ...(reactivate ? { status: "active" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, item.id));
      updated++;
    }

    const retired = 0;

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
