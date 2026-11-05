# Layout publish engine (server only): design

Date: 2026-11-05. Workstream B4 (first slice). Status: awaiting review.

## Purpose

Let a manager publish a draft floor-plan version for an event. Publishing validates the layout and syncs `inventory_items` in one transaction without breaking existing sales. This slice is server-only. The Konva editor (B1-B3) follows later and will call these entry points.

## Out of scope

Konva editor, properties panel, drafts/copy UI, guest preview, ticket-type CRUD (D1), reassignment workflow (D3), API routes.

## Existing code this builds on

- `src/domain/layout.ts`: geometry schema (`layoutGeometry`).
- `src/db/schema.ts`: `layouts`, `layout_versions` (draft | published | superseded), `events.publishedLayoutVersionId`, `ticket_types`, `inventory_items` (unique per event + `object_key`), `allocations`.
- `src/server/permissions.ts`: `requireEventCapability(..., "event.manage")`.
- `src/server/audit.ts`, `src/server/errors.ts` (`AppError`).
- `src/server/booking/holds.ts`: locks the event row `FOR UPDATE` first. Publish uses the same lock order.

## Units

| File | Purpose |
|---|---|
| `src/domain/layout-validation.ts` | Pure `validateLayout(geometry, ticketTypes)` returning `Issue[]` (`{ code, objectKey?, message }`). No I/O, never throws. |
| `src/server/layouts/diff.ts` | Pure diff of existing keyed inventory vs new geometry: `create`, `update`, `retire`, `removedKeys`. |
| `src/server/layouts/publish.ts` | `publishLayoutVersion(db, { actorUserId, versionId })`. Transactional. Returns counts summary. |
| `tests/unit/layout-validation.test.ts`, `tests/integration/layout-publish.test.ts` | Unit tests and real-Postgres integration tests. |

## Validation rules

- Geometry passes `layoutGeometry.parse`.
- Object keys unique; labels unique among bookable objects.
- Every bookable object has `booking`; its `ticketTypeKey` exists for the event.
- Capacity > 0. For `exclusive_table`, capacity equals the ticket type's `admissionsPerUnit`. For `seat`, capacity is 1 (DB check `inventory_items_exclusive_capacity_one`).
- Ticket type kind matches booking mode (`table` for `exclusive_table`, `seat` for `seat`).
- Ticket type price must be set (`priceMinor >= 0`). A price of 0 is valid (free ticket).
- A zone is tables-only or seats-only: a bookable object with a `zoneKey` must match that zone's `zoneMode`.
- Non-bookable objects carry no `booking`.

## Publish transaction

1. `requireEventCapability(tx, actor, eventId, "event.manage")`.
2. Lock the event row `FOR UPDATE`.
3. Load the version: must be `draft` and belong to a layout for this event, else `conflict`. Run the validator; any issues throw `AppError("validation", ..., { issues })`.
4. Diff geometry against the event's `inventory_items` that have an `object_key` (GA pools have no key and are never touched).
5. For each keyed item missing from the new geometry, check for active allocations (`confirmed`, or `held` and unexpired). If any, throw `AppError("conflict", ..., { keys, needs: "reassignment" })`. Otherwise set status `retired` (never delete).
6. Apply in sorted-id order: insert new items; update label, zone, ticket type, status on existing ones; reactivate a `retired` item whose key returns. Capacity and kind changes are refused (`conflict`) on items that have any allocations.
7. Mark the previous published version `superseded`; mark this version `published` with `publishedAt`; set `events.publishedLayoutVersionId`.
8. `audit(tx, ...)` with counts only (created, updated, retired), no personal data.

Any throw rolls back everything, so a refused publish changes nothing.

## Errors and concurrency

- Re-publishing a published or superseded version is `conflict`. Rolling back means creating a new draft.
- Concurrent publishes serialize on the event lock; the second fails the state check.
- Issues are structured so the editor can attach them to canvas objects later.

## Testing

Unit: one test per validation rule.

Integration (real Postgres, existing harness):
- Clean publish creates, updates and retires the expected items.
- Existing allocations keep the same `inventory_item_id` after a layout change (issue B4 acceptance test).
- Removing a sold table is refused and nothing changes.
- Removing an unsold table retires it.
- Capacity change on a sold item is refused.
- Non-manager gets `forbidden`; a stranger gets `not_found`.
- Publish concurrent with a hold: no deadlock, no double sale.
- Audit row written.

## Decisions made on the user's behalf (confirm at review)

- Price 0 counts as "has a price".
- Capacity changes on items that have allocations are refused.
