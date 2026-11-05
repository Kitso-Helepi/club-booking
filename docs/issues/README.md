# Issue drafts

Local drafts only; **no remote issues have been created**. Copy each one into GitHub when the team is ready. No one is assigned.

Working agreement:
- One branch per issue: `ws-<letter>/<issue-number>-<short-name>` (e.g. `ws-b/b1-konva-canvas`).
- Small, focused commits; open a PR early as a draft.
- At least one reviewer from a *different* workstream.
- PR must pass `npm run ci`. Any change to booking, payment or check-in logic needs a Postgres integration test.

| Workstream | File |
|---|---|
| A. Foundation, Neon, staff permissions | [A-foundation.md](A-foundation.md) |
| B. Floor plan editor | [B-floor-plan-editor.md](B-floor-plan-editor.md) |
| C. Guest booking | [C-guest-booking.md](C-guest-booking.md) |
| D. Orders, inventory, payment simulation | [D-orders-inventory-payments.md](D-orders-inventory-payments.md) |
| E. Tickets and notifications | [E-tickets-notifications.md](E-tickets-notifications.md) |
| F. Door check-in | [F-door-check-in.md](F-door-check-in.md) |

Dependency overview:

```
A1 ─┬─ A2 ── A3
    ├─ B1 ── B2 ── B3 ── B4 (publish) ── D3 (reassignment)
    ├─ C1, C2
    ├─ D1 ── D2 (cancellation) ── E3 (cancellation emails), F2
    ├─ E1 ── E2
    └─ F1 ── F2
```
