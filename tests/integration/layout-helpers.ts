import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { layoutVersions } from "@/db/schema";
import { layoutGeometry, type LayoutGeometry } from "@/domain/layout";
import { addMembership, assignToEvent, insertBareUser } from "@/server/fixtures";
import theDen from "../../fixtures/layouts/the-den.json";
import type { freshEvent } from "./helpers";

type Ev = Awaited<ReturnType<typeof freshEvent>>;

/** Insert a new draft version of the event's layout: the fixture geometry with `mutate` applied. Returns its id. */
export async function createDraft(ev: Ev, mutate: (g: LayoutGeometry) => void = () => {}, layoutId = ev.layout) {
  const g = layoutGeometry.parse(theDen);
  mutate(g);
  return insertDraftGeometry(ev, g, layoutId);
}

/** Insert a draft with arbitrary (possibly invalid) stored geometry. */
export async function insertDraftGeometry(ev: Ev, geometry: unknown, layoutId = ev.layout) {
  const [{ next }] = await db()
    .select({ next: sql<number>`coalesce(max(${layoutVersions.version}), 0) + 1` })
    .from(layoutVersions)
    .where(eq(layoutVersions.layoutId, layoutId));
  const [row] = await db()
    .insert(layoutVersions)
    .values({ clubId: ev.club, layoutId, version: next, state: "draft", geometry })
    .returning({ id: layoutVersions.id });
  return row.id;
}

/** A staff user with the given role in the event's club (door staff are also assigned to the event). */
export async function managerFor(ev: Ev, role: "manager" | "owner" | "door" = "manager") {
  const id = await insertBareUser(db(), `${role}-${randomUUID().slice(0, 8)}@example.test`);
  await addMembership(db(), ev.club, id, role);
  if (role === "door") await assignToEvent(db(), ev.club, ev.event, id);
  return id;
}
