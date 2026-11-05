/**
 * Publish-time checks for a floor plan. Pure: no I/O, never throws.
 * An empty result means the layout may be published.
 */
import { layoutGeometry } from "./layout";

export type TicketTypeInfo = {
  key: string;
  kind: "general_admission" | "seat" | "table";
  priceMinor: number;
  admissionsPerUnit: number;
};

export type LayoutIssueCode =
  | "geometry_invalid"
  | "duplicate_key"
  | "duplicate_label"
  | "label_required"
  | "booking_missing"
  | "booking_on_decorative"
  | "ticket_type_unknown"
  | "ticket_type_kind_mismatch"
  | "capacity_invalid"
  | "price_invalid"
  | "zone_mode_mismatch";

export type LayoutIssue = { code: LayoutIssueCode; objectKey?: string; message: string };

export function validateLayout(geometry: unknown, ticketTypes: TicketTypeInfo[]): LayoutIssue[] {
  const parsed = layoutGeometry.safeParse(geometry);
  if (!parsed.success) {
    return [{ code: "geometry_invalid", message: "The saved floor plan is not valid and cannot be published." }];
  }
  const issues: LayoutIssue[] = [];
  const add = (code: LayoutIssueCode, message: string, objectKey?: string) => issues.push({ code, message, objectKey });
  const objects = parsed.data.objects;
  const typeByKey = new Map(ticketTypes.map((t) => [t.key, t]));
  const zones = new Map(objects.filter((o) => o.type === "zone").map((o) => [o.key, o]));

  const seenKeys = new Set<string>();
  const reportedKeys = new Set<string>();
  for (const o of objects) {
    if (seenKeys.has(o.key) && !reportedKeys.has(o.key)) {
      reportedKeys.add(o.key);
      add("duplicate_key", `More than one object uses the key "${o.key}".`, o.key);
    }
    seenKeys.add(o.key);
  }

  const seenLabels = new Set<string>();
  const reportedLabels = new Set<string>();
  for (const o of objects) {
    if (!o.bookable) {
      if (o.booking) add("booking_on_decorative", `${o.key} is not bookable but has booking settings.`, o.key);
      continue;
    }
    if (!o.label.trim()) {
      add("label_required", "Bookable objects need a label.", o.key);
    } else if (seenLabels.has(o.label) && !reportedLabels.has(o.label)) {
      reportedLabels.add(o.label);
      add("duplicate_label", `The label "${o.label}" is used more than once.`, o.key);
    }
    seenLabels.add(o.label);

    if (!o.booking) {
      add("booking_missing", `${o.label || o.key} is bookable but has no booking settings.`, o.key);
      continue;
    }
    const type = typeByKey.get(o.booking.ticketTypeKey);
    if (!type) {
      add("ticket_type_unknown", `Ticket type "${o.booking.ticketTypeKey}" does not exist for this event.`, o.key);
    } else {
      const expectedKind = o.booking.mode === "seat" ? "seat" : "table";
      if (type.kind !== expectedKind) {
        add("ticket_type_kind_mismatch", `${type.key} is a ${type.kind} ticket and cannot be used for a ${expectedKind}.`, o.key);
      }
      const expectedCapacity = o.booking.mode === "seat" ? 1 : type.admissionsPerUnit;
      if (o.booking.capacity !== expectedCapacity) {
        add("capacity_invalid", `Capacity must be ${expectedCapacity} for ${type.key}.`, o.key);
      }
      if (!Number.isInteger(type.priceMinor) || type.priceMinor < 0) {
        add("price_invalid", `Ticket type ${type.key} has no valid price.`, o.key);
      }
    }
    const zone = o.zoneKey ? zones.get(o.zoneKey) : undefined;
    if (zone?.zoneMode) {
      const needed = o.booking.mode === "seat" ? "seats" : "tables";
      if (zone.zoneMode !== needed) {
        add("zone_mode_mismatch", `Zone ${zone.label || zone.key} sells ${zone.zoneMode} only.`, o.key);
      }
    }
  }
  return issues;
}
