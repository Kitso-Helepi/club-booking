# Workstream F: Door check-in

Read first: `src/server/checkin.ts`, `src/components/staff/door-screen.tsx`, `docs/VENUE_AND_DOOR_GUIDE.md`.

## F1. Physical phone test pass
**Depends on:** HTTPS staging host (A2 + host decision).
**Acceptance:** complete `docs/PHONE_TESTING.md` on two devices; file bugs for failures; record real results (no "assumed pass").

## F2. Door recent-scans list + undo-free safety
**Depends on:** none.
**Acceptance:** the door screen shows the last 10 results for this device. Admissions can't be undone from the door (manager-only, audited, separate issue).

## F3. Scanner performance tuning
**Depends on:** F1.
**Acceptance:** choose the best camera automatically, torch toggle where supported, scan-to-result ≤ 1.5 s on a mid-range Android in low light.
