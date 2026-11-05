import { describe, expect, it } from "vitest";
import { validateLayout, type LayoutIssue, type TicketTypeInfo } from "@/domain/layout-validation";
import type { LayoutGeometry } from "@/domain/layout";
import theDen from "../../fixtures/layouts/the-den.json";

const types: TicketTypeInfo[] = [
  { key: "general", kind: "general_admission", priceMinor: 15000, admissionsPerUnit: 1 },
  { key: "balcony-seat", kind: "seat", priceMinor: 35000, admissionsPerUnit: 1 },
  { key: "vip-table-6", kind: "table", priceMinor: 450000, admissionsPerUnit: 6 },
  { key: "table-4", kind: "table", priceMinor: 280000, admissionsPerUnit: 4 },
];

function run(mutate: (g: LayoutGeometry) => void = () => {}, ticketTypes: TicketTypeInfo[] = types): LayoutIssue[] {
  const g = structuredClone(theDen) as unknown as LayoutGeometry;
  mutate(g);
  return validateLayout(g, ticketTypes);
}
const obj = (g: LayoutGeometry, key: string) => g.objects.find((o) => o.key === key)!;
const codes = (issues: LayoutIssue[]) => issues.map((i) => i.code);

describe("validateLayout", () => {
  it("accepts the seeded fixture", () => {
    expect(run()).toEqual([]);
  });

  it("reports geometry that does not parse as a single geometry_invalid", () => {
    const issues = validateLayout({ nope: 1 }, types);
    expect(codes(issues)).toEqual(["geometry_invalid"]);
  });

  it("flags duplicate keys", () => {
    const issues = run((g) => g.objects.push({ ...obj(g, "t1") }));
    expect(issues.find((i) => i.code === "duplicate_key")?.objectKey).toBe("t1");
  });

  it("flags duplicate labels among bookable objects", () => {
    const issues = run((g) => (obj(g, "t2").label = obj(g, "t1").label));
    expect(codes(issues)).toContain("duplicate_label");
  });

  it("requires a label on bookable objects", () => {
    const issues = run((g) => (obj(g, "t1").label = ""));
    expect(issues).toContainEqual(expect.objectContaining({ code: "label_required", objectKey: "t1" }));
  });

  it("requires booking on bookable objects", () => {
    const issues = run((g) => delete obj(g, "t1").booking);
    expect(issues).toContainEqual(expect.objectContaining({ code: "booking_missing", objectKey: "t1" }));
  });

  it("rejects booking on decorative objects", () => {
    const issues = run((g) => (obj(g, "stage").booking = { mode: "seat", ticketTypeKey: "balcony-seat", capacity: 1 }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "booking_on_decorative", objectKey: "stage" }));
  });

  it("rejects an unknown ticket type", () => {
    const issues = run((g) => (obj(g, "t1").booking!.ticketTypeKey = "nope"));
    expect(issues).toContainEqual(expect.objectContaining({ code: "ticket_type_unknown", objectKey: "t1" }));
  });

  it("rejects a ticket type whose kind does not match the booking mode", () => {
    const issues = run((g) => (obj(g, "b1").booking!.ticketTypeKey = "vip-table-6"));
    expect(issues).toContainEqual(expect.objectContaining({ code: "ticket_type_kind_mismatch", objectKey: "b1" }));
  });

  it("requires table capacity to equal the ticket type's admissions per unit", () => {
    const issues = run((g) => (obj(g, "t1").booking!.capacity = 5));
    expect(issues).toContainEqual(expect.objectContaining({ code: "capacity_invalid", objectKey: "t1" }));
  });

  it("requires seat capacity of 1", () => {
    const issues = run((g) => (obj(g, "b1").booking!.capacity = 2));
    expect(issues).toContainEqual(expect.objectContaining({ code: "capacity_invalid", objectKey: "b1" }));
  });

  it("rejects a negative price", () => {
    const bad = types.map((t) => (t.key === "vip-table-6" ? { ...t, priceMinor: -1 } : t));
    expect(codes(run(() => {}, bad))).toContain("price_invalid");
  });

  it("accepts a price of 0 (free ticket)", () => {
    const free = types.map((t) => (t.key === "vip-table-6" ? { ...t, priceMinor: 0 } : t));
    expect(run(() => {}, free)).toEqual([]);
  });

  it("rejects a table placed in a seats-only zone", () => {
    const issues = run((g) => (obj(g, "t1").zoneKey = "balcony"));
    expect(issues).toContainEqual(expect.objectContaining({ code: "zone_mode_mismatch", objectKey: "t1" }));
  });
});
