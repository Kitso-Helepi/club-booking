# API examples

All bodies are JSON. Errors look like:

```json
{ "error": { "code": "unavailable", "message": "T1 is no longer available", "details": { "itemId": "…" } } }
```

Codes: `validation` 400, `unauthenticated` 401, `invalid_signature` 401, `forbidden` 403, `not_allowed_in_mode` 403, `not_found` 404, `unavailable` 409, `capacity_exceeded` 409, `conflict` 409, `hold_expired` 410, `rate_limited` 429, `internal` 500.

## Guest

### Create a hold: `POST /api/holds`

```json
{ "eventId": "00000000-0000-4000-8000-000000000003",
  "items": [ { "inventoryItemId": "<T1 item id>", "quantity": 1 } ] }
```

`201`:

```json
{ "holdId": "3d2b7ea0-…", "expiresAt": "2026-11-05T08:26:31.505Z", "currency": "ZAR", "totalMinor": 450000, "admissions": 6 }
```

Prices are never accepted from the client. Seats and tables require `quantity: 1`; GA allows 1–20.

### Release a hold: `DELETE /api/holds/:holdId`

`{ "released": true }`

### Checkout: `POST /api/holds/:holdId/checkout`

```json
{ "buyerName": "Thandi Test", "buyerEmail": "thandi@example.test", "buyerPhone": "", "whatsappOptIn": false }
```

```json
{ "orderId": "…", "bookingReference": "CB-TPXGGG4P", "orderPath": "/o/<secret>",
  "redirectUrl": "/simulator/sim_…", "state": "pending_payment" }
```

Free baskets return `"state": "confirmed"` with `redirectUrl` = `orderPath`.

### Order status (polling): `GET /api/orders/:token/status`

`{ "state": "confirmed", "passes": 6 }`

## Payments

### Webhook: `POST /api/payments/webhooks/:provider`

Simulator events are signed with HMAC-SHA256 over the raw body (`x-simulator-signature`):

```json
{ "type": "payment.succeeded", "session_id": "sim_…", "merchant_id": "sim_merchant_<clubId>",
  "amount_minor": 450000, "currency": "ZAR", "id": "evt_…" }
```

`{ "received": true, "outcome": "confirmed" }`. Outcomes: `confirmed`, `confirmed_late`, `already_confirmed`, `duplicate`, `failed`, `reconciliation`, `mismatch`, `unknown_session`, `ignored`.

### Simulator control (test mode only): `POST /api/simulator/:sessionId`

`{ "outcome": "success" | "failure" | "duplicate" | "late_success" }` → `{ "results": ["confirmed","duplicate"], "orderPath": "/o/…" }`

## Staff (session cookie required)

Sign in via Better Auth: `POST /api/auth/sign-in/email` `{ "email": "...", "password": "..." }`.

### Check in: `POST /api/staff/events/:eventId/check-in`

`{ "token": "http://localhost:3000/p/<token>" }` (full URL or bare token) or `{ "passId": "<uuid>" }`

```json
{ "result": "admitted",
  "pass": { "id": "…", "label": "T1 · Guest 2 of 6", "bookingReference": "CB-TPXGGG4P", "admittedAt": "2026-11-05T08:19:37.159Z" },
  "group": { "label": "T1", "admitted": 2, "total": 6 } }
```

`result` ∈ `admitted | already_used | cancelled | wrong_event | invalid`. A repeat scan returns `already_used` with the **original** `admittedAt`.

### Door lookup: `GET /api/staff/events/:eventId/lookup?q=CB-TPXG`

```json
{ "results": [ { "orderId": "…", "bookingReference": "CB-TPXGGG4P", "state": "confirmed", "buyerName": "Thandi T.",
                 "passes": [ { "id": "…", "label": "T1 · Guest 1 of 6", "state": "valid", "admittedAt": null } ] } ],
  "stats": { "issued": 6, "admitted": 2, "admissionCap": 200 } }
```
