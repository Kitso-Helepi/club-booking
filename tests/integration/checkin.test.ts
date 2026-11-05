/**
 * Door check-in and cross-club isolation, against REAL Postgres.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { checkInRecords, passes } from "@/db/schema";
import { checkIn, lookupBooking } from "@/server/checkin";
import { searchOrders } from "@/server/orders";
import { decryptToken } from "@/server/tokens";
import { addMembership, assignToEvent, ensureClubWithEvent, insertBareUser } from "@/server/fixtures";
import { bookAndPay, freshEvent, settle } from "./helpers";

async function tableBookingWithDoorStaff() {
  const ev = await freshEvent();
  const door = await insertBareUser(db(), `door-${ev.club.slice(0, 8)}@example.test`);
  await addMembership(db(), ev.club, door, "door");
  await assignToEvent(db(), ev.club, ev.event, door);
  const { checkout } = await bookAndPay(ev.event, [{ inventoryItemId: ev.item("t1").id, quantity: 1 }]);
  const ps = await db().select().from(passes).where(eq(passes.orderId, checkout.orderId));
  const tokens = ps.map((p) => decryptToken(p.tokenEncrypted));
  return { ev, door, checkout, passes: ps, tokens };
}

describe("check-in", () => {
  it("two simultaneous scans of one pass produce one admission", async () => {
    const { ev, door, tokens } = await tableBookingWithDoorStaff();
    const { ok } = await settle([1, 2].map(() => checkIn(door, ev.event, { token: tokens[0] })));
    const results = ok.map((r) => r.result).sort();
    expect(results).toEqual(["admitted", "already_used"]);
    const admittedAt = ok.map((r) => r.pass?.admittedAt);
    expect(admittedAt[0]).toBe(admittedAt[1]); // repeat shows ORIGINAL time
    const admissions = await db().select().from(checkInRecords).where(eq(checkInRecords.result, "admitted"));
    expect(admissions.filter((a) => a.eventId === ev.event)).toHaveLength(1);
  });

  it("groups can arrive separately and table counts stay correct", async () => {
    const { ev, door, tokens } = await tableBookingWithDoorStaff();
    const r1 = await checkIn(door, ev.event, { token: tokens[0] });
    const r2 = await checkIn(door, ev.event, { token: `http://localhost:3000/p/${tokens[1]}` }); // full QR URL
    expect(r2.group).toEqual({ label: "T1", admitted: 2, total: 6 });
    expect(r1.group?.admitted).toBe(1);
    // The rest arrive later; a repeat scan does not change the count.
    for (const t of tokens.slice(2)) await checkIn(door, ev.event, { token: t });
    const repeat = await checkIn(door, ev.event, { token: tokens[3] });
    expect(repeat.result).toBe("already_used");
    expect(repeat.group).toEqual({ label: "T1", admitted: 6, total: 6 });
  });

  it("supports manual admission of a specific pass", async () => {
    const { ev, door, passes: ps } = await tableBookingWithDoorStaff();
    const r = await checkIn(door, ev.event, { passId: ps[2].id });
    expect(r.result).toBe("admitted");
  });

  it("rejects cancelled passes", async () => {
    const { ev, door, passes: ps, tokens } = await tableBookingWithDoorStaff();
    await db().update(passes).set({ state: "cancelled" }).where(eq(passes.id, ps[0].id));
    const idx = 0;
    expect((await checkIn(door, ev.event, { token: tokens[idx] })).result).toBe("cancelled");
  });

  it("reports wrong event for a pass from another event of the same club", async () => {
    const { ev, door, tokens } = await tableBookingWithDoorStaff();
    const second = await ensureClubWithEvent(db(), { ids: { club: ev.club, venue: ev.venue }, eventSlug: `second-${Date.now()}` });
    await assignToEvent(db(), ev.club, second.event, door);
    expect((await checkIn(door, second.event, { token: tokens[0] })).result).toBe("wrong_event");
  });

  it("reports invalid for junk and unknown tokens", async () => {
    const { ev, door } = await tableBookingWithDoorStaff();
    expect((await checkIn(door, ev.event, { token: "hello" })).result).toBe("invalid");
    expect((await checkIn(door, ev.event, { token: "A".repeat(43) })).result).toBe("invalid");
  });

  it("door staff must be assigned to the event", async () => {
    const { ev, tokens } = await tableBookingWithDoorStaff();
    const unassigned = await insertBareUser(db(), `unassigned-${ev.club.slice(0, 8)}@example.test`);
    await addMembership(db(), ev.club, unassigned, "door");
    await expect(checkIn(unassigned, ev.event, { token: tokens[0] })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("cross-club isolation", () => {
  it("one club's staff cannot access another club's private records", async () => {
    const a = await tableBookingWithDoorStaff();
    const otherClub = await freshEvent();
    const otherOwner = await insertBareUser(db(), `owner-${otherClub.club.slice(0, 8)}@example.test`);
    await addMembership(db(), otherClub.club, otherOwner, "owner");

    // Club B's owner cannot scan, look up or search club A's event.
    await expect(checkIn(otherOwner, a.ev.event, { token: a.tokens[0] })).rejects.toMatchObject({ code: "not_found" });
    await expect(lookupBooking(otherOwner, a.ev.event, a.checkout.bookingReference)).rejects.toMatchObject({ code: "not_found" });
    await expect(searchOrders(otherOwner, a.ev.event, "")).rejects.toMatchObject({ code: "not_found" });

    // Club A's pass scanned at club B's event reveals nothing.
    const r = await checkIn(otherOwner, otherClub.event, { token: a.tokens[0] });
    expect(r).toEqual({ result: "invalid" });

    // Club B's search of its own event never returns club A's orders.
    const own = await searchOrders(otherOwner, otherClub.event, a.checkout.bookingReference);
    expect(own).toHaveLength(0);
  });

  it("a manager can search their own club's orders by booking reference", async () => {
    const a = await tableBookingWithDoorStaff();
    const mgr = await insertBareUser(db(), `mgr-${a.ev.club.slice(0, 8)}@example.test`);
    await addMembership(db(), a.ev.club, mgr, "manager");
    const found = await searchOrders(mgr, a.ev.event, a.checkout.bookingReference);
    expect(found.map((o) => o.bookingReference)).toEqual([a.checkout.bookingReference]);
    // Door staff cannot use the manager order search.
    await expect(searchOrders(a.door, a.ev.event, "")).rejects.toMatchObject({ code: "forbidden" });
  });
});
