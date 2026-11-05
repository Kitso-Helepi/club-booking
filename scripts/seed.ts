/**
 * Repeatable SYNTHETIC seed for local development and staging.
 *   npm run db:seed
 *
 * Creates (only if missing): the Velvet Fox club, The Den venue, the sample
 * event with its published layout and inventory, and four staff accounts.
 * It never deletes or updates existing data.
 */
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { user } from "@/db/schema";
import { auth } from "@/server/auth";
import { PILOT_IDS, addMembership, assignToEvent, ensureClubWithEvent } from "@/server/fixtures";

const STAFF = [
  { email: "owner@velvetfox.test", name: "Olu Owner", role: "owner" as const },
  { email: "manager@velvetfox.test", name: "Mpho Manager", role: "manager" as const },
  { email: "door1@velvetfox.test", name: "Door One", role: "door" as const },
  { email: "door2@velvetfox.test", name: "Door Two", role: "door" as const },
];

async function main() {
  const password = process.env.SEED_STAFF_PASSWORD;
  if (!password || password.length < 12 || password.startsWith("replace-")) {
    throw new Error("Set SEED_STAFF_PASSWORD (12+ chars) in .env before seeding");
  }
  const ids = await ensureClubWithEvent(db(), { ids: PILOT_IDS });

  for (const s of STAFF) {
    let [u] = await db().select().from(user).where(eq(user.email, s.email));
    if (!u) {
      await auth().api.signUpEmail({ body: { email: s.email, password, name: s.name } });
      [u] = await db().select().from(user).where(eq(user.email, s.email));
      console.log(`Created staff account ${s.email} (${s.role})`);
    }
    await addMembership(db(), ids.club, u.id, s.role);
    if (s.role === "door") await assignToEvent(db(), ids.club, ids.event, u.id);
  }

  console.log("Seed complete.");
  console.log("Guest event link: /c/velvet-fox/e/midnight-frequencies");
  console.log("Staff sign-in:    /staff/login  (password = SEED_STAFF_PASSWORD in your .env)");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
