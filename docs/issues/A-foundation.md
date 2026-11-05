# Workstream A: Foundation, Neon and staff permissions

## A1. Run CI on GitHub and make it green
**Depends on:** nothing (needs repo push approval).
**Acceptance:** the workflow in `.github/workflows/ci.yml` passes on a PR; role-creation step works on the service container.
**Review:** check no secrets in the workflow; CI values are throwaway.

## A2. Neon staging database
**Depends on:** A1, approval of Neon project (free tier).
**Acceptance:** follow `docs/NEON_SETUP.md`; `npm run test:integration` passes against a Neon branch named `*_test`; app connects with the pooled URL as `club_app`.
**Review:** confirm `club_app` cannot `CREATE TABLE`; connection strings live only in the host's secret store.

## A3. Owner screens: staff memberships and event assignments
**Depends on:** A1.
**Acceptance:** an owner can invite/add staff (email + temporary password or invite link), change role, remove member, assign door staff to events. Every action writes `audit_events`. Managers and door staff get 403/404 from the server (tested).
**Review:** try each endpoint as each role and as another club's owner. Permission checks must be in `src/server`, not only in the UI.

## A4. Audit history viewer
**Depends on:** A3.
**Acceptance:** owners see their club's audit events, newest first, filterable by entity. Other clubs' events are never visible (integration test).
