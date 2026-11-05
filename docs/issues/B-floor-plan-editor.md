# Workstream B: Floor plan editor

Read first: `src/domain/layout.ts` (geometry schema), `fixtures/layouts/the-den.json`, `docs/ARCHITECTURE.md`.

## B1. Konva canvas basics
**Depends on:** A1.
**Acceptance:** `/staff/events/[id]/layout` (managers/owners only) renders a layout version with react-konva (load it with `dynamic(..., { ssr: false })`). Add table/chair/booth/zone/bar/stage/entrance/label; select, move, resize, rotate (Transformer); grid snapping; zoom and pan (pinch on touch); undo/redo (keep a history stack of geometry snapshots).
**Review:** geometry saved still passes `layoutGeometry.parse`; keyboard delete/duplicate work.

## B2. Properties panel
**Depends on:** B1.
**Acceptance:** edit label, key (auto-generated, read-only once sold), bookable flag, zone, booking mode, ticket type, capacity. Inline validation messages.

## B3. Drafts, copy and preview
**Depends on:** B2.
**Acceptance:** start from blank or copy a saved venue layout; save draft (new `layout_versions` row, state `draft`); reopen; "Preview as guest" renders the guest `FloorMap` with the draft.

## B4. Publish with validation and inventory sync
**Depends on:** B3, D1.
**Acceptance:** publishing validates unique labels/keys, capacities > 0, every bookable object has a ticket type with a price, and a zone is tables-only or seats-only. In one transaction (lock event row first): create/update `inventory_items` by `object_key`; never delete an item with active allocations; removed objects with sales block publishing and point to the reassignment workflow (D3); mark previous version `superseded`; audit. **Test:** layout changes preserve existing allocations.
**Review:** try to publish a version that removes a sold table. It must be refused.
