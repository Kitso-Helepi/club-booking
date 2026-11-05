# Implementation plan

Legend: ✅ done and tested · 🟡 partly done · ⬜ not started. Issue drafts are in `docs/issues/`.

## Phase 1: Foundation (workstream A) ✅
- ✅ Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui scaffold, pinned versions, lockfile
- ✅ Drizzle schema for every required entity; first migration
- ✅ Local Postgres 17 + Mailpit (Docker), separate app/migrator roles
- ✅ Repeatable synthetic seed
- ✅ Better Auth staff login; roles and event assignments; server permission helpers
- ✅ Cross-club isolation tests
- ✅ CI workflow (lint, typecheck, Postgres tests, build). **Not yet run on GitHub** (nothing pushed)
- ⬜ Owner screens: manage staff memberships, venues, club settings; audit viewer

## Phase 2: Vertical slice: six-person table ✅
- ✅ Event page (venue-local time, policies), SVG map + list alternative
- ✅ Atomic holds with lock order + DB constraint backstop; visible expiry
- ✅ Checkout → simulator → signed webhook → confirmation
- ✅ Six distinct passes, private order page, single-pass pages, WhatsApp share links
- ✅ Door: code entry, lookup, manual admit, table counts, repeat-scan handling, UNVERIFIED state
- 🟡 Camera scanning (ZXing) built; needs physical testing
- 🟡 Playwright journey written; not run

## Phase 3: Floor plan editor + publishing (workstream B) ⬜
- ⬜ Konva editor: add/move/resize/rotate/duplicate/label, snapping, zoom/pan, undo
- ⬜ Blank layout / copy saved layout; save draft, reopen, preview as guest
- 🟡 Publish with validation (labels, capacities, prices, zone modes): server engine done (`src/server/layouts/publish.ts`), no editor or route yet
- 🟡 Inventory sync on publish preserving allocations: done; audited reassignment workflow still ⬜

## Phase 4: Seats + GA complete (workstream C/D) 🟡
- ✅ Server: seats, GA pools, event cap, mixed baskets, tests
- 🟡 Guest UI: works; needs zone-level filtering and a quantity limit per order setting

## Phase 5: Notifications, cancellations, exceptions (D/E) 🟡
- ✅ Notification jobs, Nodemailer/Mailpit worker, backoff, delivery attempts, allowlist
- ⬜ Staff resend (audited), message history screen
- ⬜ Cancellation service: revoke passes, reopen inventory once, refund record
- ⬜ Reconciliation case screen for managers
- ⬜ Meta Cloud API adapter (stub, disabled)

## Phase 6: Pilot acceptance ⬜
- ⬜ Run Playwright + full integration suite on CI
- ⬜ Integration tests against a Neon branch
- ⬜ Physical phone checklist (`docs/PHONE_TESTING.md`)
- ⬜ Layout-change-preserves-allocations test (needs phase 3)
