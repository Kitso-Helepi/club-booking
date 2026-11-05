/**
 * Staff authentication (Better Auth, email + password).
 *
 * Better Auth answers "who is this person?". Club memberships, roles and event
 * assignments live in our own tables (club_memberships, event_staff_assignments)
 * and are checked in src/server/permissions.ts, so authorization can run inside
 * the same database transaction as the booking/check-in it protects.
 *
 * Guests never sign in.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { db, schema } from "@/db/client";
import { AppError } from "./errors";

function createAuth() {
  return betterAuth({
    appName: process.env.APP_NAME ?? "Club Booking",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Staff accounts are created by an owner or the seed script, not self-service.
      disableSignUp: process.env.NODE_ENV === "production",
      minPasswordLength: 12,
      // Creating a staff account must not sign that person in.
      autoSignIn: false,
    },
    session: { expiresIn: 60 * 60 * 12 }, // a shift
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __clubAuth?: Auth };

export function auth(): Auth {
  if (!g.__clubAuth) g.__clubAuth = createAuth();
  return g.__clubAuth;
}

export type StaffUser = { id: string; email: string; name: string };

/** Returns the signed-in staff user, or null. */
export async function getStaffUser(): Promise<StaffUser | null> {
  const s = await auth().api.getSession({ headers: await headers() });
  if (!s) return null;
  return { id: s.user.id, email: s.user.email, name: s.user.name };
}

export async function requireStaffUser(): Promise<StaffUser> {
  const u = await getStaffUser();
  if (!u) throw new AppError("unauthenticated", "Please sign in");
  return u;
}
