# Club Booking (working name)

Mobile-first booking for club nights: guests pick general admission, a reserved seat or an exclusive table from a floor map, pay (simulated in the pilot), and get one QR pass per guest. Staff check guests in at the door from their phones.

> **"Club Booking" is a placeholder name.** Change it in one place: `APP_NAME` in `.env`.
> **All club, venue, event and staff data is synthetic.** Payments are simulated, so no money moves.

## Status: what works today

| Area | Status |
|---|---|
| Schema, migrations, role split (app vs migrator) | ✅ Working, tested on local Postgres 17 |
| Seed: club, venue, event, layout, inventory, 4 staff | ✅ Working (`npm run db:seed`) |
| Staff sign-in (Better Auth), server-side permissions | ✅ Working |
| Guest event page, SVG floor map + list alternative | ✅ Working |
| Holds (10 min, atomic, lock-ordered) | ✅ Working + concurrency tests |
| Checkout, simulator (success / fail / duplicate / late) | ✅ Working + tests |
| Confirmation → passes + notification jobs (atomic, idempotent) | ✅ Working + tests |
| Private order page, individual pass pages, WhatsApp share links | ✅ Working |
| Door screen: code entry, booking lookup, manual admit, group counts | ✅ Working (code entry checked in a browser; API over HTTP) |
| Door screen: **camera QR scanning** | ⚠️ Built, **not verified**. Needs a real phone over HTTPS (see `docs/PHONE_TESTING.md`) |
| Email confirmations via Nodemailer → Mailpit, retry/backoff | ✅ Working (one real email captured in Mailpit) |
| Seats and GA in holds/passes | ✅ Server logic + tests. Guest UI supports them |
| Floor plan **editor** (Konva) + publish workflow | ❌ Not started (workstream B) |
| Cancellations/refunds, staff resend, message history | ❌ Schema only (workstreams D/E) |
| Owner screens (staff, venues, audit viewer) | ❌ Not started |
| Playwright journey | ⚠️ Written (`tests/e2e`), **not run yet** (browsers not installed) |
| Automated WhatsApp (Meta Cloud API) | ❌ Disabled by design. Jobs are skipped |

The full checklist is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Requirements

- **Node.js 22 LTS** (`>=22.12 <23`, see `.nvmrc`). Tested with 22.17.1.
- npm 10
- Docker Desktop (local Postgres 17 + Mailpit)

> **Windows/OneDrive tip:** don't keep the project inside a OneDrive-synced folder. OneDrive syncs `node_modules` and makes the dev server slow (we saw this during development). Use something like `C:\dev\club-booking`.

## Setup (first time)

```bash
npm ci
```

```bash
cp .env.example .env
```

Edit `.env` and replace every `replace-...` value. Generate the two keys with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then start Postgres and Mailpit, migrate and seed:

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

- Guest event: http://localhost:3000/c/velvet-fox/e/midnight-frequencies
- Staff: http://localhost:3000/staff/login. Accounts are `owner@velvetfox.test`, `manager@velvetfox.test`, `door1@velvetfox.test` and `door2@velvetfox.test`. The password is `SEED_STAFF_PASSWORD` from your `.env`.
- Captured emails (Mailpit): http://localhost:8025

Confirmation emails are sent automatically right after a booking is confirmed (open Mailpit to see them). If sending fails, for example because Mailpit or SMTP is down, the email stays queued and the booking is unaffected. Run the worker to retry anything queued (once, or keep it watching):

```bash
npm run worker:notifications -- --watch
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates Next route types, then `tsc` |
| `npm test` | Unit + **real Postgres** integration tests (needs `npm run db:up`) |
| `npm run test:unit` / `npm run test:integration` | One project only |
| `npm run test:e2e` | Playwright journey (first: `npx playwright install chromium`; needs a seeded DB) |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (migration role). Never resets data |
| `npm run db:seed` | Insert synthetic pilot data if missing. Never overwrites |
| `npm run worker:notifications` | Send due notification jobs |
| `npm run ci` | lint + typecheck + tests + build |

Integration tests use a **separate** database and refuse to run unless its name ends in `_test`.

## Architecture in one page

```
Browser (guest / staff)
   │  fetch JSON
   ▼
Next.js App Router
   ├─ src/app/**            pages + route handlers (thin: parse, auth, call server module)
   ├─ src/server/**         business rules (holds, checkout, payments, check-in, permissions)
   ├─ src/db/schema.ts      Drizzle schema (single source of truth for tables)
   └─ src/domain/**         shared types (layout geometry)
   ▼
Postgres (Neon in staging, Docker locally) via node-postgres over TCP
```

Key rules students should know:

1. **The server decides.** Prices, totals and availability are recalculated on the server; the browser only asks.
2. **One lock order.** Every transaction that changes inventory locks the **event row first**, then inventory rows sorted by id. This prevents deadlocks and double bookings.
3. **Belt and braces.** A partial unique index allows only one active allocation per seat or table. Passes are unique per `(allocation, sequence)`; confirmation emails are unique per `(order, channel)`. Retries can't create extras.
4. **Expiry needs no cron.** A held allocation only counts while `expires_at > now()`.
5. **Payments are confirmed only by a verified webhook**, never by the browser redirect.
6. **Authorization is in `src/server/permissions.ts`** and runs on every staff request. Unknown or other-club records return "not found".
7. **Tokens:** QR codes contain only a random token URL. We store a SHA-256 hash for lookup and an AES-256-GCM copy (key in env) for re-display.

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API examples: [docs/API.md](docs/API.md) · Layout fixture: `fixtures/layouts/the-den.json`.

## Decisions made (all reversible)

| Decision | Why |
|---|---|
| `pg` (node-postgres) over TCP, not Neon's HTTP driver | Booking needs interactive transactions with `SELECT … FOR UPDATE`. App uses Neon's **pooled** URL; migrations use the **direct** URL. |
| Club memberships/roles/event assignments in **our tables**; Better Auth only for login and sessions | Door staff need per-event assignment, and permission checks must sit beside booking queries. Better Auth's organization plugin could replace `club_memberships` later; flag this if you'd rather use it now. |
| Guest floor map in **SVG**, Konva reserved for the staff editor | SVG gives real focusable buttons (keyboard and screen readers) and is lighter on phones. |
| Next.js Cache Components **off** | Nearly every page is per-request. The classic model is simpler to learn. |
| Currency ZAR, time zone Africa/Johannesburg in the seed | A guess for the pilot. Change it in `src/server/fixtures.ts`. Display always uses the venue's zone. |
| Rate limiting stored in Postgres | Works on serverless without adding Redis. |
| No `server-only` package | Server modules are also used by scripts and tests. Keep server code in `src/server`. |

## Known limitations

- Floor plan editor, publishing, audited reassignment: **not built**.
- Cancellation/refund flow: tables exist, no service or UI yet.
- Staff resend + message history screens: not built (worker + `delivery_attempts` exist).
- Camera scanning, two-device scanning, low light and connection loss: **not tested on real phones**.
- On staging, anyone holding a simulator session URL can "pay" (test mode only; disabled in live mode).
- Rate limits are per hashed IP, which is coarse behind shared NAT (club Wi-Fi).
- Seed users get a fixed password from `.env`; there's no password reset flow yet.
- `npm audit` reports 12 moderate advisories in dev tooling (drizzle-kit's old esbuild, eslint's minimatch). None ship to the browser. Re-check before launch.

## Unresolved launch decisions (need an owner)

- Product name and domain.
- HTTPS staging host (Vercel, Netlify, Fly, …). **Nothing has been deployed.**
- Live payment provider (hosted checkout) and its refund API.
- SMTP provider for staging and the recipient allowlist.
- Whether automated WhatsApp (Meta Cloud API, paid) is wanted at all.
- Real currency/time zone and the club's entry and refund policies.
- Data retention period for buyer contact details.

## Handover docs

- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): phased checklist with status
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): state machines, locking, security
- [docs/API.md](docs/API.md): request/response examples
- [docs/NEON_SETUP.md](docs/NEON_SETUP.md): Neon roles and connection strings
- [docs/VENUE_AND_DOOR_GUIDE.md](docs/VENUE_AND_DOOR_GUIDE.md): venue setup and door operations
- [docs/PHONE_TESTING.md](docs/PHONE_TESTING.md): physical device checklist (not yet performed)
- [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md): what was actually run
- [docs/LICENCES.md](docs/LICENCES.md): dependency licences
- [docs/issues/](docs/issues/): issue drafts for workstreams A–F
