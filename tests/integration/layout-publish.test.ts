/**
 * Layout publish engine against REAL Postgres.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { allocations, auditEvents, events, inventoryItems, layoutVersions, layouts } from "@/db/schema";
import { createHold } from "@/server/booking/holds";
import { isAppError } from "@/server/errors";
import { publishLayoutVersion } from "@/server/layouts/publish";
import { bookAndPay, forceExpireHold, freshEvent, settle } from "./helpers";
import { createDraft, insertDraftGeometry, managerFor } from "./layout-helpers";
import { ensureClubWithEvent } from "@/server/fixtures";

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return e;
    throw e;
  }
  throw new Error("Expected the promise to reject");
}

const versionState = async (id: string) =>
  (await db().select().from(layoutVersions).where(eq(layoutVersions.id, id)))[0].state;
const itemByKey = async (eventId: string, key: string) =>
  (await db().select().from(inventoryItems).where(and(eq(inventoryItems.eventId, eventId), eq(inventoryItems.objectKey, key))))[0];

describe("publishLayoutVersion: happy path and guards", () => {
  it("publishes a draft", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const draft = await createDraft(ev, (g) => {
      const b8 = g.objects.find((o) => o.key === "b8")!;
      g.objects.push({ ...structuredClone(b8), key: "b9", label: "B9" });
    });

    const result = await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    expect(result).toEqual({ versionId: draft, created: 1, updated: 0, retired: 0 });
    const [published] = await db().select().from(layoutVersions).where(eq(layoutVersions.id, draft));
    expect(published.state).toBe("published");
    expect(published.publishedAt).not.toBeNull();
    expect(await versionState(ev.layoutVersion)).toBe("superseded");
    const [event] = await db().select().from(events).where(eq(events.id, ev.event));
    expect(event.publishedLayoutVersionId).toBe(draft);
    expect(await itemByKey(ev.event, "b9")).toBeDefined();
    const audits = await db().select().from(auditEvents).where(eq(auditEvents.entityId, draft));
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("layout.publish");
    expect(audits[0].data).toEqual({ created: 1, updated: 0, retired: 0 });
  });

  it("updates label on existing items and keeps their ids", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const before = await itemByKey(ev.event, "t1");
    const draft = await createDraft(ev, (g) => (g.objects.find((o) => o.key === "t1")!.label = "Booth 1"));

    const result = await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    expect(result).toMatchObject({ created: 0, updated: 1, retired: 0 });
    const after = await itemByKey(ev.event, "t1");
    expect(after.id).toBe(before.id);
    expect(after.label).toBe("Booth 1");
  });

  it("refuses to publish an invalid layout and changes nothing", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const draft = await createDraft(ev, (g) => (g.objects.find((o) => o.key === "t1")!.label = ""));

    const err = await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }));

    expect(err.code).toBe("validation");
    expect((err.details as { issues: { code: string }[] }).issues[0].code).toBe("label_required");
    expect(await versionState(draft)).toBe("draft");
    const [event] = await db().select().from(events).where(eq(events.id, ev.event));
    expect(event.publishedLayoutVersionId).toBe(ev.layoutVersion);
  });

  it("refuses corrupt stored geometry with a validation error", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const draft = await insertDraftGeometry(ev, { bad: true });

    const err = await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }));

    expect(err.code).toBe("validation");
    expect((err.details as { issues: { code: string }[] }).issues[0].code).toBe("geometry_invalid");
  });

  it("refuses a version that is not a draft", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const draft = await createDraft(ev);
    await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    expect((await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }))).code).toBe("conflict");
    expect((await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: ev.layoutVersion }))).code).toBe("conflict");
  });

  it("refuses a venue-template layout that belongs to no event", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const [template] = await db()
      .insert(layouts)
      .values({ id: randomUUID(), clubId: ev.club, venueId: ev.venue, eventId: null, name: "Template" })
      .returning();
    const draft = await createDraft(ev, () => {}, template.id);

    expect((await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }))).code).toBe("conflict");
    expect(await versionState(draft)).toBe("draft");
  });

  it("does not let a manager of another club publish this event's draft", async () => {
    const a = await freshEvent();
    const b = await freshEvent();
    const managerOfA = await managerFor(a);
    const draftOfB = await createDraft(b);

    expect((await rejection(publishLayoutVersion(db(), { actorUserId: managerOfA, versionId: draftOfB }))).code).toBe("not_found");
    expect(await versionState(draftOfB)).toBe("draft");
  });

  it("enforces roles: door forbidden, stranger not found, owner allowed", async () => {
    const ev = await freshEvent();
    const draft = await createDraft(ev);
    const door = await managerFor(ev, "door");
    const stranger = await managerFor(await freshEvent());
    const owner = await managerFor(ev, "owner");

    expect((await rejection(publishLayoutVersion(db(), { actorUserId: door, versionId: draft }))).code).toBe("forbidden");
    expect((await rejection(publishLayoutVersion(db(), { actorUserId: stranger, versionId: draft }))).code).toBe("not_found");
    await expect(publishLayoutVersion(db(), { actorUserId: owner, versionId: draft })).resolves.toMatchObject({ versionId: draft });
  });
});

const remove = (...keys: string[]) => (g: import("@/domain/layout").LayoutGeometry) => {
  g.objects = g.objects.filter((o) => !keys.includes(o.key));
};
const sellTable = (ev: Awaited<ReturnType<typeof freshEvent>>, key = "t1") =>
  bookAndPay(ev.event, [{ inventoryItemId: ev.item(key).id, quantity: 1 }]);

describe("publishLayoutVersion: sales safety", () => {
  it("refuses to remove a sold table and changes nothing", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    await sellTable(ev);
    const draft = await createDraft(ev, remove("t1"));

    const err = await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }));

    expect(err.code).toBe("conflict");
    expect(err.details).toMatchObject({ keys: ["t1"], needs: "reassignment" });
    expect((await itemByKey(ev.event, "t1")).status).toBe("active");
    expect(await versionState(draft)).toBe("draft");
    expect(await db().select().from(auditEvents).where(eq(auditEvents.entityId, draft))).toHaveLength(0);
    const [event] = await db().select().from(events).where(eq(events.id, ev.event));
    expect(event.publishedLayoutVersionId).toBe(ev.layoutVersion);
  });

  it("refuses to remove a table with a live hold", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("t1").id, quantity: 1 }] });
    const draft = await createDraft(ev, remove("t1"));

    const err = await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }));
    expect(err.code).toBe("conflict");
  });

  it("lets an expired hold go: the table is retired", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const hold = await createHold({ eventId: ev.event, items: [{ inventoryItemId: ev.item("t1").id, quantity: 1 }] });
    await forceExpireHold(hold.holdId);
    const draft = await createDraft(ev, remove("t1"));

    const result = await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    expect(result.retired).toBe(1);
    expect((await itemByKey(ev.event, "t1")).status).toBe("retired");
  });

  it("retires an unsold removed table but keeps the row", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const before = await itemByKey(ev.event, "t3");
    const draft = await createDraft(ev, remove("t3"));

    const result = await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    expect(result).toMatchObject({ created: 0, updated: 0, retired: 1 });
    const after = await itemByKey(ev.event, "t3");
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("retired");
  });

  it("retires an unavailable item when its object is removed", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    await db().update(inventoryItems).set({ status: "unavailable" }).where(eq(inventoryItems.id, ev.item("t4").id));
    const draft = await createDraft(ev, remove("t4"));

    await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });
    expect((await itemByKey(ev.event, "t4")).status).toBe("retired");
  });

  it("keeps existing allocations pointing at the same item", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    await sellTable(ev);
    const item = ev.item("t1");
    const draft = await createDraft(ev, (g) => {
      const t1 = g.objects.find((o) => o.key === "t1")!;
      t1.label = "Renamed";
      t1.x += 20;
    });

    await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    const allocs = await db().select().from(allocations).where(eq(allocations.inventoryItemId, item.id));
    expect(allocs.filter((a) => a.state === "confirmed")).toHaveLength(1);
    expect((await itemByKey(ev.event, "t1")).id).toBe(item.id);
  });

  it("refuses to resize a sold table, but allows it while unsold", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    await sellTable(ev, "t1");
    const resize = (key: string) => (g: import("@/domain/layout").LayoutGeometry) => {
      const t = g.objects.find((o) => o.key === key)!;
      t.booking = { mode: "exclusive_table", ticketTypeKey: "table-4", capacity: 4 };
    };

    const err = await rejection(publishLayoutVersion(db(), { actorUserId: actor, versionId: await createDraft(ev, resize("t1")) }));
    expect(err.code).toBe("conflict");
    expect(err.details).toMatchObject({ keys: ["t1"], reason: "change_with_sales" });

    const before = await itemByKey(ev.event, "t2");
    await publishLayoutVersion(db(), { actorUserId: actor, versionId: await createDraft(ev, resize("t2")) });
    expect((await itemByKey(ev.event, "t2")).ticketTypeId).not.toBe(before.ticketTypeId);
  });

  it("reactivates a retired key with its original id", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const original = await itemByKey(ev.event, "t3");
    await publishLayoutVersion(db(), { actorUserId: actor, versionId: await createDraft(ev, remove("t3")) });
    expect((await itemByKey(ev.event, "t3")).status).toBe("retired");

    await publishLayoutVersion(db(), { actorUserId: actor, versionId: await createDraft(ev) });

    const back = await itemByKey(ev.event, "t3");
    expect(back.status).toBe("active");
    expect(back.id).toBe(original.id);
  });

  it("leaves staff-unavailable items unavailable", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    await db().update(inventoryItems).set({ status: "unavailable" }).where(eq(inventoryItems.id, ev.item("t2").id));
    const draft = await createDraft(ev, (g) => (g.objects.find((o) => o.key === "t2")!.label = "Renamed"));

    await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    const t2 = await itemByKey(ev.event, "t2");
    expect(t2.status).toBe("unavailable");
    expect(t2.label).toBe("Renamed");
  });
});

describe("publishLayoutVersion: concurrency", () => {
  it("two simultaneous publishes of one draft: one wins, one gets a conflict", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const draft = await createDraft(ev, (g) => (g.objects.find((o) => o.key === "t1")!.label = "Once"));

    const { ok, errors } = await settle([1, 2].map(() => publishLayoutVersion(db(), { actorUserId: actor, versionId: draft })));

    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(isAppError(errors[0]) && errors[0].code).toBe("conflict");
  });

  it("a publish racing a hold on the same table never both succeeds", async () => {
    for (let i = 0; i < 5; i++) {
      const ev = await freshEvent();
      const actor = await managerFor(ev);
      const t1 = ev.item("t1");
      const draft = await createDraft(ev, remove("t1"));

      const { ok, errors } = await settle<unknown>([
        publishLayoutVersion(db(), { actorUserId: actor, versionId: draft }),
        createHold({ eventId: ev.event, items: [{ inventoryItemId: t1.id, quantity: 1 }] }),
      ]);

      // Exactly one side wins, and the loser is a business error (no deadlock or 500).
      expect(ok).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(isAppError(errors[0])).toBe(true);
      const held = await db().select().from(allocations).where(eq(allocations.inventoryItemId, t1.id));
      const status = (await itemByKey(ev.event, "t1")).status;
      if (held.length > 0) {
        expect(status).toBe("active");
        expect(await versionState(draft)).toBe("draft");
      } else {
        expect(status).toBe("retired");
        expect(await versionState(draft)).toBe("published");
      }
    }
  });
});

describe("publishLayoutVersion: review fixes", () => {
  it("updates kind when an unsold seat becomes a table", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const draft = await createDraft(ev, (g) => {
      const b1 = g.objects.find((o) => o.key === "b1")!;
      delete b1.zoneKey;
      b1.booking = { mode: "exclusive_table", ticketTypeKey: "table-4", capacity: 4 };
    });

    const result = await publishLayoutVersion(db(), { actorUserId: actor, versionId: draft });

    expect(result.updated).toBe(1);
    expect((await itemByKey(ev.event, "b1")).kind).toBe("table");
  });

  it("refuses a draft that belongs to a different event of the same club when eventId is given", async () => {
    const ev = await freshEvent();
    const actor = await managerFor(ev);
    const other = await ensureClubWithEvent(db(), { ids: { club: ev.club, venue: ev.venue }, eventSlug: `other-${randomUUID().slice(0, 8)}` });
    const otherDraft = await createDraft({ ...ev, ...other } as unknown as Parameters<typeof createDraft>[0]);

    const err = await rejection(publishLayoutVersion(db(), { actorUserId: actor, eventId: ev.event, versionId: otherDraft }));

    expect(err.code).toBe("conflict");
    expect(await versionState(otherDraft)).toBe("draft");
  });
});
