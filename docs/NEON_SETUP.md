# Neon setup (staging), not done yet

No Neon project has been created or connected. These are the steps when one is approved (Neon's free tier is enough for the pilot; **do not enable paid plans without approval**).

1. Create a Neon project in a region close to the club, with Postgres 17.
2. In the SQL editor, as the owner role, create two roles. Use generated passwords and store them in your host's secret manager only.

```sql
CREATE ROLE club_migrator LOGIN PASSWORD '<generated>';
CREATE ROLE club_app LOGIN PASSWORD '<generated>';
CREATE DATABASE club_booking OWNER club_migrator;
```

3. Connect to `club_booking` and run the same grants as `db/init/01-roles.sql` (the `REVOKE CREATE`, `GRANT USAGE` and two `ALTER DEFAULT PRIVILEGES` statements).
4. Connection strings:
   - `DATABASE_URL` = **pooled** endpoint (`…-pooler…neon.tech`), role `club_app`, `?sslmode=require`.
   - `MIGRATION_DATABASE_URL` = **direct** endpoint, role `club_migrator`, `?sslmode=require`.
5. Run `npm run db:migrate` from CI or a trusted machine with `MIGRATION_DATABASE_URL` set, then `npm run db:seed` once.

Why the pooled endpoint works for the app: Neon's pooler is PgBouncer in **transaction** mode. Each `BEGIN … COMMIT` stays on one server connection, so `SELECT … FOR UPDATE` inside a transaction is safe. Avoid session-level features (session advisory locks, `SET` without `LOCAL`, `LISTEN`).

Verification still to do on Neon: run `npm run test:integration` against a Neon **branch** whose database name ends in `_test`, to confirm the lock and concurrency behaviour through the pooler.
