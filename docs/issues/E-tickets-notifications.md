# Workstream E: Tickets and notifications

## E1. Staff resend + message history
**Depends on:** D1.
**Acceptance:** "Resend confirmation" creates a `resend` job (requires `orders.resend`), audited with the staff user; the order page lists jobs and delivery attempts (status, time, provider id, error), never the full email body.

## E2. Worker hosting
**Depends on:** A2.
**Acceptance:** worker runs on a schedule in staging (e.g. a cron route protected by a secret header, or the host's scheduler). `EMAIL_DELIVERY_MODE=allowlist` in staging. Documented.

## E3. Cancellation email
**Depends on:** D2.
**Acceptance:** cancellation creates a `cancellation` job; email states passes are void and refund status.

## E4. Meta Cloud API adapter (stub)
**Depends on:** decision on WhatsApp.
**Acceptance:** adapter interface + disabled implementation; jobs only created when `WHATSAPP_AUTOMATION_ENABLED=true` **and** buyer opted in (existing logic in `confirm.ts`). No paid account activated.
