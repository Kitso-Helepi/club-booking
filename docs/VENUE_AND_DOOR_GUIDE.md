# Venue setup and door operations

## Venue setup (pilot, via seed)

Until the floor plan editor ships (workstream B), venues are set up from JSON:

1. Copy `fixtures/layouts/the-den.json` and draw the room in canvas units (800×600 works well on phones).
2. Each object needs a stable lowercase `key` (`t1`, `b4`). **Never reuse or rename a key that has sold inventory.** Allocations follow keys.
3. Decorative objects (`stage`, `bar`, `entrance`, `label`) have `"bookable": false`.
4. Zones set `"zoneMode": "tables"` or `"seats"`. A zone sells only one kind per event.
5. Bookable tables: `"booking": { "mode": "exclusive_table", "ticketTypeKey": "vip-table-6", "capacity": 6 }`. Capacity equals the number of passes issued.
6. Seats: `"mode": "seat"`, capacity 1.
7. Ticket types (names, prices in **cents**, admissions per unit) are in `PILOT_TICKET_TYPES` in `src/server/fixtures.ts`.
8. Set the event `admissionCap`. Every pass (table guests included) counts toward it.

## Door operations

**Before doors open**
- Each door phone: sign in at `/staff/login` → choose the event → **Door**.
- Allow the camera when asked. The camera **only works over HTTPS** (or localhost).
- Turn screen brightness up and set auto-lock to "never" for the shift.
- Do a test scan on each device with a staff test pass.

**Reading the screen**

| Screen | Meaning | Action |
|---|---|---|
| Green **ADMIT** | Valid, first use. Recorded now | Let them in |
| Amber **ALREADY USED** + time | This pass was already scanned | Don't admit. Check the time and ask for their own pass |
| Red **CANCELLED** | Booking cancelled | Don't admit. Send to manager |
| Red **WRONG EVENT** | Pass for another night | Don't admit |
| Red **INVALID** | Not our pass / damaged code | Try **Look up** by booking reference |
| Grey **UNVERIFIED** | No answer from the server | **Do not admit on this scan.** Retry when connected; use another phone |

**Tables:** each guest has their own pass. The result shows `T1: 3 of 6 in`, so groups can arrive separately.

**No QR?** Use **Look up**: type the booking reference (e.g. `CB-TPXGGG4P`, or its last 4+ characters), check the name (first name + initial), and tap **Admit** on one unused pass per person.

**Connection lost:** the header shows **OFFLINE**. The pilot has **no offline admission**. Every result needs the server. Fall back to a manager decision and note names manually.
