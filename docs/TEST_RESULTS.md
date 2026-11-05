# Test results: what was actually run

**Date:** 2026-11-05 · **Machine:** Windows 11, Node 22.17.1, npm 10.9.2 · **Database:** Postgres 17.6 in Docker (`club_booking_test`), app role `club_app`

## Automated

| Command | Result |
|---|---|
| `npm run lint` | ✅ 0 problems |
| `npm run typecheck` | ✅ no errors |
| `npm test` (unit + integration) | ✅ 34/34 passed; integration suite repeated 3× with no flakes |
| `npm run build` | ✅ production build succeeded |
| `npm run db:migrate` (local) | ✅ |
| `npm run db:seed` run twice | ✅ second run created nothing new (1 club, 13 inventory items, 4 users) |
| `npm run test:e2e` | ⚠️ **not run** (Playwright browsers not installed) |
| GitHub Actions CI | ⚠️ **not run** (nothing pushed) |
| Tests against Neon | ⚠️ **not run** (no Neon project) |

## Required acceptance tests → where they are

| Requirement | Test | Status |
|---|---|---|
| Two simultaneous attempts for last seat/table → one allocation | `booking.test.ts` › concurrency (8 parallel for a table, 2 for a seat) | ✅ |
| Concurrent bookings cannot exceed event capacity | `booking.test.ts` › admission cap (table passes count) | ✅ |
| Six-person table → exactly six passes | `booking.test.ts` › six-person table journey | ✅ |
| Duplicate payment notifications → no extra passes/jobs | `booking.test.ts` › duplicate (sequential + concurrent) | ✅ |
| Late payment for resold inventory → reconciliation case | `booking.test.ts` › late payment resold | ✅ |
| Two simultaneous scans → one admission | `checkin.test.ts` | ✅ |
| Groups arrive separately, counts correct | `checkin.test.ts` | ✅ |
| Cancelled passes rejected | `checkin.test.ts` (pass state set directly; the cancellation **service** isn't built yet) | 🟡 |
| One club cannot access another's private records | `checkin.test.ts` › cross-club isolation | ✅ |
| Layout changes preserve allocations | needs the publish workflow (B4) | ⬜ not written |
| Failed notifications retried without changing booking | `notifications.test.ts` | ✅ |

## Manual checks performed

In the Claude desktop browser pane, phone-sized viewport (375×812), against `npm run dev`:

1. Opened `/c/velvet-fox/e/midnight-frequencies`: event details, venue-local time, map and legend render.
2. Selected T1 on the map → basket R 4 500,00, 6 admissions → **Reserve** → checkout with countdown.
3. Entered synthetic buyer details → simulator → **"Success, notified twice"** → order page showed *Booking confirmed* and **6 passes**. DB check: 1 order, 6 passes, 1 notification job, 1 provider event row (the duplicate was dropped).
4. Signed in as `door1`: staff page showed **Door only** (no Orders link), as expected for the role.
5. Door screen: the camera was blocked by the browser pane, and the app showed its fallback message. **Camera scanning remains unverified.**
6. Door API over HTTP with a staff session (curl): pass 1 → `admitted` (1/6); pass 1 again → `already_used` with the original time; pass 2 → `admitted` (2/6); no session → 401.
7. `npm run worker:notifications` → one confirmation email captured in Mailpit.

Physical phone checks: **none performed**. See `PHONE_TESTING.md`.
