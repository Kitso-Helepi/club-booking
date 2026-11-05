# Architecture

## Modules

| Path | Responsibility |
|---|---|
| `src/db/schema.ts` | All tables, enums, constraints and indexes |
| `src/db/client.ts` | Connection pool (`db()`), `Tx` type |
| `src/server/booking/availability.ts` | Availability maths (respects expiry) |
| `src/server/booking/holds.ts` | Create/release holds, lock order, sweep |
| `src/server/booking/checkout.ts` | Order creation, payment start, free orders |
| `src/server/booking/confirm.ts` | Atomic confirmation: allocations → passes → notification jobs |
| `src/server/payments/provider.ts` | Payment adapter interface + live-mode guard |
| `src/server/payments/simulator*.ts` | Test-mode simulated gateway (signed webhooks) |
| `src/server/payments/process-event.ts` | Webhook processing: dedupe, verify, late payment, reconciliation |
| `src/server/checkin.ts` | Atomic admission, lookup, door stats |
| `src/server/permissions.ts` | Roles → capabilities, club + event scope |
| `src/server/notifications/*` | Email transport, worker with backoff |
| `src/server/tokens.ts` | Token generation, hashing, AES-GCM encryption, booking refs |

## State machines

```
Hold:        active ──► converted        (order confirmed)
                    ├─► released       (guest cancels / payment failed)
                    └─► expired        (time ran out; sweep is housekeeping only)

Allocation:  held ──► confirmed ──► cancelled   (future: accepted cancellation)
                 ├─► released
                 └─► expired ──► confirmed       (late payment, only if re-acquired atomically)

Order:       pending_payment ──► confirmed ──► cancelled
                             ├─► payment_failed
                             ├─► expired
                             └─► needs_reconciliation   (late payment, inventory gone; or mismatch)

PaymentAttempt: created ──► succeeded | failed | superseded (guest restarted checkout)

Pass:        valid ──► cancelled        admitted_at set once (NULL → timestamp), never cleared

Notification job: pending ──► sending ──► sent
                                     ├─► failed ──(backoff)──► sending …
                                     └─► skipped (allowlist / channel disabled)
```

Cancellation (`cancellations`) and refund (`refunds`) are **separate tables**: deciding to cancel is ours, while the refund's progress belongs to the provider. A partial unique index allows one *accepted* cancellation per order, so inventory reopens exactly once.

## Concurrency rules

1. Any transaction that changes inventory for an event begins with `SELECT … FROM events WHERE id = $1 FOR UPDATE`.
2. Then it locks `inventory_items` rows `ORDER BY id`.
3. Then it locks order/payment rows.
4. Admission is a single conditional `UPDATE … WHERE admitted_at IS NULL`. It does not use the event lock, so door scans never wait for bookings.

Backstops: `allocations_one_active_exclusive_uq`, `passes_allocation_sequence_uq`, `notification_jobs_initial_uq`, `provider_events_provider_event_uq`, `check_in_records_one_admission_uq`, `cancellations_one_accepted_uq`.

## Payments: future real gateway checklist

- Use **hosted checkout**; card data never touches our servers.
- Implement `PaymentProvider` (`createCheckout`, `parseWebhook`, `merchantIdForClub`).
- `parseWebhook` must verify the signature over the **raw** body.
- `processProviderEvent` already deduplicates provider events and checks merchant, currency and amount.
- Never mark paid from the redirect; the order page only polls status.
- Add a refund method to the adapter for workstream D.

## Security notes

- Contact details live only on `orders`. Audit `data`, logs and QR codes never contain them.
- Order and pass links carry 256-bit random tokens; pages set `referrer: no-referrer` and `noindex`.
- Booking references are for support only and grant no access. Door lookup shows first name + initial.
- Cross-club access returns `not_found`, so we don't confirm another club's records exist.
- Secrets come from env only (`.env` is git-ignored). Config validation never prints values.
- Public endpoints (`/api/holds`, checkout) have Postgres-backed rate limits; sign-in uses Better Auth's limiter (5/min).
- The DB app role cannot run DDL. Migrations use a separate role.
