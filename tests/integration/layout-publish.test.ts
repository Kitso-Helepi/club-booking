/**
 * Layout publish engine against REAL Postgres.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, events, inventoryItems, layoutVersions, layouts } from "@/db/schema";
import { isAppError } from "@/server/errors";
import { publishLayoutVersion } from "@/server/layouts/publish";
import { freshEvent } from "./helpers";
import { createDraft, insertDraftGeometry, managerFor } from "./layout-helpers";

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
