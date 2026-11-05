# Layout Publish Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A transactional, validated `publishLayoutVersion()` that publishes a draft floor-plan version for an event and syncs `inventory_items` without disturbing existing sales.

**Architecture:** Two pure modules (validator, inventory diff) plus one transactional service that follows the `holds.ts` lock order (event row `FOR UPDATE` first). Server only: no editor, no API routes.

**Tech Stack:** TypeScript, Drizzle ORM on Postgres, Zod 4, Vitest (unit project, and integration project against real Postgres via `npm run db:up`).

**Spec:** `docs/superpowers/specs/2026-11-05-layout-publish-engine-design.md`

## Global Constraints

- Geometry shape is `layoutGeometry` in `src/domain/layout.ts`; do not change it.
- Keyed inventory rows (`object_key` not null) always have `capacity = 1` (DB check `inventory_items_exclusive_capacity_one`). The guest count of a table comes from `ticket_types.admissions_per_unit`, and `booking.capacity` in geometry must equal it.
- Never delete `inventory_items`; removed objects become `status = 'retired'`.
- GA pools (`object_key` null) are never read or written by publish.
- "Active allocation" means the existing `activeAllocation` SQL predicate exported from `src/server/booking/availability.ts` (confirmed, or held and unexpired). Reuse it; do not redefine it.
- Authorization: `requireEventCapability(tx, actorUserId, eventId, "event.manage")`. Strangers get `not_found`, door staff get `forbidden`.
- Audit rows carry counts only, no personal data. Errors are `AppError` from `src/server/errors.ts`.
- Next.js in this repo has breaking changes (`AGENTS.md`); this plan touches no Next APIs, so no Next docs reading is needed.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Bookable object with an empty label: validator issue `label_required` (inventory `label` is NOT NULL and guests see it).
- Draft belonging to a venue template (`layouts.event_id` null) or another event's layout: refused, never published to the wrong event.
- Item staff set to `unavailable`: stays `unavailable` after republish (only `retired` items are reactivated).
- Held allocation whose `expires_at` has passed does not block removal; an unexpired held one does.
- Stored geometry that fails `layoutGeometry.parse` (old or corrupt row): a `validation` error with an issue, never a 500.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/layout-validation.ts` | Pure `validateLayout`; exports `LayoutIssue`, `TicketTypeInfo`. |
| `src/server/layouts/diff.ts` | Pure `diffInventory`; exports its types. |
| `src/server/layouts/publish.ts` | `publishLayoutVersion` transaction. |
| `tests/unit/layout-validation.test.ts`, `tests/unit/layout-diff.test.ts` | Unit tests. |
| `tests/integration/layout-publish.test.ts` | Real-Postgres tests. |
| `tests/integration/layout-helpers.ts` | `createDraft`, `managerFor` test helpers. |
| `README.md` | Status table row for the editor/publish line. |

---

### Task 1: Layout validator (pure)

**Files:**
- Create: `src/domain/layout-validation.ts`
- Test: `tests/unit/layout-validation.test.ts`

**Interfaces:**
- Produces:
  - `type TicketTypeInfo = { key: string; kind: "general_admission" | "seat" | "table"; priceMinor: number; admissionsPerUnit: number }`
  - `type LayoutIssue = { code: LayoutIssueCode; objectKey?: string; message: string }`
  - `type LayoutIssueCode = "geometry_invalid" | "duplicate_key" | "duplicate_label" | "label_required" | "booking_missing" | "booking_on_decorative" | "ticket_type_unknown" | "ticket_type_kind_mismatch" | "capacity_invalid" | "price_invalid" | "zone_mode_mismatch"`
  - `validateLayout(geometry: unknown, ticketTypes: TicketTypeInfo[]): LayoutIssue[]` (never throws, no I/O; `[]` means publishable)

- [ ] **Step 1: Write failing tests** in `tests/unit/layout-validation.test.ts`. Build `base` from `fixtures/layouts/the-den.json` with ticket types `general`, `balcony-seat` (seat, 35000, 1), `vip-table-6` (table, 450000, 6), `table-4` (table, 280000, 4). One test per row, each cloning `base` and mutating one thing, asserting the issue `code` (and `objectKey` where it applies):
  - the unmodified fixture returns `[]`
  - `validateLayout({ nope: 1 }, types)` returns one `geometry_invalid`
  - two objects with key `t1` give `duplicate_key`
  - `t2.label = t1.label` gives `duplicate_label`; `t1.label = ""` gives `label_required` on `t1`
  - delete `t1.booking` gives `booking_missing`; add `booking` to `stage` gives `booking_on_decorative`
  - `ticketTypeKey: "nope"` gives `ticket_type_unknown`
  - `b1` pointed at `vip-table-6` gives `ticket_type_kind_mismatch`
  - `t1.booking.capacity = 5` (type says 6) gives `capacity_invalid`; `b1.booking.capacity = 2` gives `capacity_invalid`
  - ticket type `priceMinor: -1` gives `price_invalid`; `priceMinor: 0` gives no issue
  - `t1.zoneKey = "balcony"` (a seats zone) gives `zone_mode_mismatch`
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/layout-validation.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `validateLayout`** per the signatures above. Parse with `layoutGeometry.safeParse` first (failure returns one `geometry_invalid`); collect all issues rather than stopping at the first. Zone rule: look up the object's `zoneKey` among `type === "zone"` objects; `exclusive_table` needs `zoneMode === "tables"`, `seat` needs `"seats"`; no zone mode on the zone means no issue.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `git add src/domain/layout-validation.ts tests/unit/layout-validation.test.ts` with message `Add layout validator`.

---

### Task 2: Inventory diff (pure)

**Files:**
- Create: `src/server/layouts/diff.ts`
- Test: `tests/unit/layout-diff.test.ts`

**Interfaces:**
- Consumes: `LayoutGeometry` from `src/domain/layout.ts`.
- Produces:
  - `type KeyedItem = { id: string; objectKey: string; kind: "seat" | "table"; ticketTypeId: string; zoneKey: string | null; label: string; status: "active" | "unavailable" | "retired" }`
  - `type DesiredItem = { objectKey: string; kind: "seat" | "table"; ticketTypeKey: string; zoneKey: string | null; label: string }`
  - `type InventoryDiff = { create: DesiredItem[]; matched: { item: KeyedItem; desired: DesiredItem }[]; retire: KeyedItem[] }`
  - `diffInventory(existing: KeyedItem[], geometry: LayoutGeometry): InventoryDiff`

- [ ] **Step 1: Write failing tests** in `tests/unit/layout-diff.test.ts`:
  - empty `existing` + fixture geometry: `create` has 12 entries (4 tables as `table`, 8 chairs as `seat`), `matched` and `retire` empty; decorative objects never appear
  - existing item with key `t1` is `matched` to the desired `t1`, not in `create`
  - existing key `gone` not in geometry and status `active` lands in `retire`; same with status `unavailable`; status `retired` does not appear in `retire`
  - desired `zoneKey` is `null` when the object has none
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/layout-diff.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `diffInventory`.** Desired set = objects with `bookable && booking`; `kind` from `booking.mode` (`seat` to `seat`, `exclusive_table` to `table`).
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/layouts/diff.ts tests/unit/layout-diff.test.ts` with message `Add layout inventory diff`.

---

### Task 3: publishLayoutVersion, happy path and guards

**Files:**
- Create: `src/server/layouts/publish.ts`, `tests/integration/layout-helpers.ts`
- Test: `tests/integration/layout-publish.test.ts`

**Interfaces:**
- Consumes: `validateLayout`, `diffInventory`, `requireEventCapability`, `audit`, `AppError`, `activeAllocation`, `layoutVersions`, `layouts`, `events`, `ticketTypes`, `inventoryItems`.
- Produces:
  - `publishLayoutVersion(database: Db, input: { actorUserId: string; versionId: string }): Promise<{ versionId: string; created: number; updated: number; retired: number }>`
  - helpers: `createDraft(ev: Awaited<ReturnType<typeof freshEvent>>, mutate?: (g: LayoutGeometry) => void): Promise<string>` (inserts `layout_versions` row, version = max + 1, state `draft`, geometry = fixture with `mutate` applied, returns id) and `managerFor(ev, role?: "manager" | "owner" | "door"): Promise<string>` (bare user plus membership, door also assigned to the event)

- [ ] **Step 1: Write failing tests** in `tests/integration/layout-publish.test.ts` (use `freshEvent()` from `./helpers`; every test gets its own club):
  - `publishes a draft`: draft adds a new bookable chair `b9` (copy of `b8`, new key and label `B9`). After publish: result `{ created: 1, updated: 0, retired: 0 }`; new draft row is `published` with `publishedAt` set; previous version is `superseded`; `events.publishedLayoutVersionId` equals the draft id; an `inventory_items` row exists for `b9`; one `audit_events` row with action `layout.publish` and `data` containing the three counts
  - `updates label and zone on existing items`: draft renames `t1` label to `Booth 1`; item `t1` keeps its `id` and has the new label; result `updated: 1`
  - `refuses to publish an invalid layout`: draft with `t1.label = ""`; rejects with `AppError` code `validation` and `details.issues[0].code === "label_required"`; version still `draft`, event pointer unchanged
  - `refuses corrupt stored geometry`: draft row inserted with `geometry = { bad: true }`; `validation` with `geometry_invalid`
  - `refuses a non-draft version`: publishing the draft twice, the second rejects `conflict`; publishing the seeded published v1 rejects `conflict`
  - `refuses a venue-template layout`: draft whose `layouts.event_id` is null, rejects `conflict`
  - `refuses another event's draft`: manager of club A publishing club B's draft gets `not_found`
  - `permissions`: `door` role gets `forbidden`; user with no membership gets `not_found`; `owner` succeeds
- [ ] **Step 2: Run** `npm run db:up` once, then `npx vitest run --project integration tests/integration/layout-publish.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `publishLayoutVersion`** in `src/server/layouts/publish.ts`:
  1. Non-locking pre-read of version joined to layout to find `layouts.eventId` (null or missing: `conflict` / `not_found` respectively). Then `database.transaction`:
  2. `requireEventCapability(tx, actorUserId, eventId, "event.manage")`, then `select ... from events where id = ... for update` (Drizzle `.for("update")`), mirroring `holds.ts`.
  3. Re-read the version under the lock; state must be `draft` else `conflict`. Load the event's `ticket_types`; run `validateLayout`; non-empty throws `AppError("validation", "Layout has problems", { issues })`.
  4. Load keyed inventory (`object_key is not null`), call `diffInventory`. Insert `create` items (`capacity: 1`, `status: "active"`, ticket type id resolved by key). For `matched` items update label, zoneKey, ticketTypeId, and set status `active` only when the current status is `retired`.
  5. Mark the previous `published` version for the same layout and any other published version of this event's layouts `superseded`; mark this one `published` with `publishedAt = now()`; set `events.publishedLayoutVersionId`.
  6. `audit(tx, { clubId, actorUserId, actorType: "staff", action: "layout.publish", entityType: "layout_version", entityId: versionId, data: { created, updated, retired } })`.
  7. `updated` counts matched items whose fields actually changed.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/layouts/publish.ts tests/integration/layout-publish.test.ts tests/integration/layout-helpers.ts` with message `Add transactional layout publish`.

---

### Task 4: Sales safety (removals, changes, retire and reactivate)

**Files:**
- Modify: `src/server/layouts/publish.ts` (steps 4-5 of the transaction)
- Test: `tests/integration/layout-publish.test.ts`

**Interfaces:**
- Consumes: Task 3's `publishLayoutVersion`, `createDraft`, and `bookAndPay` / `createHold` / `forceExpireHold` from `tests/integration/helpers.ts`.
- Produces: no new exports. Behavior: `AppError("conflict", ..., { keys: string[], needs: "reassignment" })` for removals with sales; `AppError("conflict", ..., { keys: string[], reason: "change_with_sales" })` for blocked changes.

- [ ] **Step 1: Write failing tests** (append):
  - `refuses to remove a sold table` (spec review check): book `t1` with `bookAndPay`, draft deletes `t1`; rejects `conflict` with `details.keys` `["t1"]` and `needs: "reassignment"`; afterwards `t1` item still `active`, version still `draft`, no `audit_events` row, event pointer unchanged
  - `refuses to remove a table with a live hold` (unexpired held allocation via `createHold`)
  - `an expired hold does not block removal`: `createHold` then `forceExpireHold`; removal succeeds and `t1` becomes `retired`
  - `retires an unsold removed table`: result `retired: 1`, item row still exists with status `retired`
  - `keeps allocations pointing at the same item`: book `t1`, publish a draft that only renames `t1` and moves it; the allocation's `inventory_item_id` is unchanged and the item id is unchanged (issue B4 acceptance test)
  - `refuses to change a sold table to a different ticket type size`: book `t1` (`vip-table-6`), draft sets `t1.booking` to `table-4` with capacity 4; `conflict` with `reason: "change_with_sales"`; same draft succeeds when `t1` is unsold and `t1`'s ticket type id changes
  - `reactivates a retired key`: publish removing `t3`, then publish a draft restoring it; item `t3` is `active` again with the original id
  - `leaves staff-unavailable items unavailable`: set `t2` status `unavailable`, publish a draft that renames `t2`; status still `unavailable`
  - `retires an unavailable item when its object is removed`
- [ ] **Step 2: Run** `npx vitest run --project integration tests/integration/layout-publish.test.ts`. Expected: new tests FAIL, Task 3 tests still PASS.
- [ ] **Step 3: Extend the transaction.** Before applying any write: query distinct `allocations.inventoryItemId` for the event where `activeAllocation` holds, restricted to the `retire` and `matched` item ids. Any `retire` item with an active allocation throws the removal conflict (all offending keys, sorted). Any `matched` item with an active allocation whose `kind` differs from desired, or whose desired ticket type's `admissionsPerUnit` differs from the current one, throws the change conflict. Apply writes in ascending item id order. `retire` sets status `retired`.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/layouts/publish.ts tests/integration/layout-publish.test.ts` with message `Protect sold inventory during layout publish`.

---

### Task 5: Concurrency, docs and full CI

**Files:**
- Modify: `README.md` (status table row "Floor plan editor (Konva) + publish workflow"), `docs/IMPLEMENTATION_PLAN.md` (tick B4 server part only if a checklist line exists)
- Test: `tests/integration/layout-publish.test.ts`

**Interfaces:**
- Consumes: `settle` from `tests/integration/helpers.ts`.

- [ ] **Step 1: Write failing/guarding tests** (append):
  - `two simultaneous publishes of the same draft`: via `settle`, exactly one fulfils and the other rejects `conflict`
  - `publish racing a hold on the same table`: `settle([publish(draft removing t1), createHold({ eventId, items: [t1] })])` many times in a loop of 5 fresh events; after each, the invariant holds: either the hold exists and publish was refused, or the hold failed and `t1` is retired; never both; no rejection other than `AppError` (no deadlock errors)
- [ ] **Step 2: Run** `npx vitest run --project integration tests/integration/layout-publish.test.ts`. Expected: PASS (the event-row lock should already serialize them). If the race test fails, fix the lock order in `publish.ts` rather than the test.
- [ ] **Step 3: Update README status row** to "Publish engine (server) done; editor UI not started" and add the `B4` note in the implementation plan doc if it has a matching line.
- [ ] **Step 4: Run** `npm run ci`. Expected: lint, typecheck, all tests and build pass. Note: the working tree already has uncommitted edits to other files; lint or build failures in them are not caused by this plan, so report them separately rather than fixing them silently.
- [ ] **Step 5: Commit** the test file, and stage only your own hunks of `README.md` and `docs/IMPLEMENTATION_PLAN.md` with `git add -p` (the user already has unrelated uncommitted edits in `README.md`; do not commit those). Message: `Test layout publish concurrency and update docs`.
