/**
 * Compares an event's keyed inventory with a layout's bookable objects.
 * Pure: the publish transaction decides what to do with the result.
 */
import type { LayoutGeometry } from "@/domain/layout";

export type KeyedItem = {
  id: string;
  objectKey: string;
  kind: "seat" | "table";
  ticketTypeId: string;
  zoneKey: string | null;
  label: string;
  status: "active" | "unavailable" | "retired";
};

export type DesiredItem = {
  objectKey: string;
  kind: "seat" | "table";
  ticketTypeKey: string;
  zoneKey: string | null;
  label: string;
};

export type InventoryDiff = {
  create: DesiredItem[];
  matched: { item: KeyedItem; desired: DesiredItem }[];
  retire: KeyedItem[];
};

export function desiredItems(geometry: LayoutGeometry): DesiredItem[] {
  const out: DesiredItem[] = [];
  for (const o of geometry.objects) {
    if (!o.bookable || !o.booking) continue;
    out.push({
      objectKey: o.key,
      kind: o.booking.mode === "seat" ? "seat" : "table",
      ticketTypeKey: o.booking.ticketTypeKey,
      zoneKey: o.zoneKey ?? null,
      label: o.label,
    });
  }
  return out;
}

export function diffInventory(existing: KeyedItem[], geometry: LayoutGeometry): InventoryDiff {
  const desired = desiredItems(geometry);
  const desiredByKey = new Map(desired.map((d) => [d.objectKey, d]));
  const existingByKey = new Map(existing.map((e) => [e.objectKey, e]));

  return {
    create: desired.filter((d) => !existingByKey.has(d.objectKey)),
    matched: existing.flatMap((item) => {
      const d = desiredByKey.get(item.objectKey);
      return d ? [{ item, desired: d }] : [];
    }),
    retire: existing.filter((e) => !desiredByKey.has(e.objectKey) && e.status !== "retired"),
  };
}
