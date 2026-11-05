# Workstream D: Orders, inventory and payment simulation

Read first: `src/server/booking/*`, `src/server/payments/*`, `tests/integration/booking.test.ts`.

## D1. Manager order detail + reconciliation queue
**Depends on:** A1.
**Acceptance:** order detail page (lines, passes, payment attempts, provider events, notification history, audit trail); list of open reconciliation cases with "resolve" (notes, audited). Scoped by club (test).

## D2. Cancellation service
**Depends on:** D1.
**Acceptance:** `cancelOrder(userId, orderId, reason)`; requires `orders.cancel`. In one transaction (event row lock first): insert accepted `cancellations` row (unique index guarantees once), set passes `cancelled`, allocations `cancelled` (reopens inventory), order `cancelled`, create `refunds` row (`pending` if paid, `not_required` if free), audit. Repeat calls return the existing result. **Tests:** cancelled passes are rejected at the door; inventory reopens exactly once under concurrent cancel calls.
**Review:** refund state must never be inferred from cancellation state.

## D3. Audited reassignment
**Depends on:** D2, B4.
**Acceptance:** manager moves a confirmed allocation to another free item of the same kind. Passes stay valid (same tokens), labels update, audit records old/new item. Required before a layout can drop a sold object.

## D4. Real gateway adapter (spike, no live keys)
**Depends on:** decision on provider.
**Acceptance:** sandbox-only implementation of `PaymentProvider` with hosted checkout + signature verification + refund call. Live keys need explicit approval.
