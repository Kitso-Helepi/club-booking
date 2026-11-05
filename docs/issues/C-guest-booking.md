# Workstream C: Guest booking

## C1. Event page polish and empty/error states
**Depends on:** none.
**Acceptance:** sold-out state, event-ended state, network-error state with retry, loading skeletons; Lighthouse accessibility ≥ 95 on mobile; map tap targets ≥ 44px effective.
**Review:** test with a screen reader (TalkBack/VoiceOver) using list view only.

## C2. Live availability refresh
**Depends on:** none.
**Acceptance:** availability refreshes every 20 s while the page is visible and immediately after a 409; a selected item that becomes unavailable is removed with a visible message.

## C3. Playwright journeys for seats and GA
**Depends on:** C1.
**Acceptance:** e2e tests for a balcony seat and a 3× GA booking; the existing table journey runs in CI against a seeded DB.
