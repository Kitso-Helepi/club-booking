# Physical phone testing (NOT YET PERFORMED)

None of these checks have been run. Record results here with device, OS, browser and date. Don't mark a check passed unless it was actually done.

## Prerequisites

- The app must be reachable over **HTTPS**; browsers block the camera on plain HTTP (except `localhost`). Options: a staging host, or a temporary tunnel to your laptop. Ask before using a paid tunnel or host.
- Two phones (ideally one Android Chrome, one iOS Safari), each signed in as a different door account (`door1`, `door2`).
- A confirmed table booking with 6 passes, shown on a third device or printed.

## Checklist

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Open door screen, grant camera | Viewfinder shows the rear camera | not run |
| 2 | Deny camera | Clear message; Enter code / Look up still work | not run |
| 3 | Scan pass 1 on phone A | Green ADMIT, `T1: 1 of 6 in` | not run |
| 4 | Scan pass 1 on phone B | Amber ALREADY USED with phone A's time; count unchanged | not run |
| 5 | Scan the same pass on both phones at the same moment | Exactly one ADMIT, one ALREADY USED | not run |
| 6 | Scan passes 2–6 alternating phones | Counts reach 6 of 6 | not run |
| 7 | Dim room (~5 lux), screen brightness 30% on the guest phone | Scans within ~2 s; note failures | not run |
| 8 | Cracked or partly covered screen | QR (error correction Q) still scans | not run |
| 9 | Airplane mode on door phone, then scan | OFFLINE header; UNVERIFIED overlay; nothing admitted | not run |
| 10 | Reconnect, rescan same pass | Normal result | not run |
| 11 | Server slow (throttle to 3G) | Result arrives; no double-admit on repeated scans | not run |
| 12 | One-handed use, phone in right and left hand | Bottom controls reachable with the thumb | not run |
| 13 | Guest shares one pass via WhatsApp | Recipient sees only that pass, no buyer details | not run |
