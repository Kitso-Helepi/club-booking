import { describe, expect, it } from "vitest";
import { layoutGeometry } from "@/domain/layout";
import { diffInventory, type KeyedItem } from "@/server/layouts/diff";
import theDen from "../../fixtures/layouts/the-den.json";

const geometry = layoutGeometry.parse(theDen);

const item = (objectKey: string, over: Partial<KeyedItem> = {}): KeyedItem => ({
  id: `id-${objectKey}`,
  objectKey,
  kind: "table",
  ticketTypeId: "tt",
  zoneKey: null,
  label: objectKey,
  status: "active",
  ...over,
});

describe("diffInventory", () => {
  it("creates one item per bookable object and ignores decorative ones", () => {
    const d = diffInventory([], geometry);
    expect(d.create).toHaveLength(12);
    expect(d.create.filter((c) => c.kind === "table")).toHaveLength(4);
    expect(d.create.filter((c) => c.kind === "seat")).toHaveLength(8);
    expect(d.create.map((c) => c.objectKey)).not.toContain("stage");
    expect(d.matched).toEqual([]);
    expect(d.retire).toEqual([]);
  });

  it("matches existing items by object key instead of creating them", () => {
    const d = diffInventory([item("t1")], geometry);
    expect(d.matched.map((m) => m.item.objectKey)).toEqual(["t1"]);
    expect(d.matched[0].desired.ticketTypeKey).toBe("vip-table-6");
    expect(d.create.map((c) => c.objectKey)).not.toContain("t1");
  });

  it("retires active and unavailable items whose object is gone", () => {
    const d = diffInventory([item("gone"), item("gone2", { status: "unavailable" })], geometry);
    expect(d.retire.map((r) => r.objectKey).sort()).toEqual(["gone", "gone2"]);
  });

  it("does not retire items that are already retired", () => {
    const d = diffInventory([item("gone", { status: "retired" })], geometry);
    expect(d.retire).toEqual([]);
  });

  it("uses null for a missing zone key", () => {
    const g = layoutGeometry.parse(theDen);
    delete g.objects.find((o) => o.key === "t1")!.zoneKey;
    const d = diffInventory([], g);
    expect(d.create.find((c) => c.objectKey === "t1")!.zoneKey).toBeNull();
  });
});
