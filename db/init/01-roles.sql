-- Runs once, the first time the local Postgres container starts with an empty volume.
-- Mirrors the role split we want on Neon:
--   club_migrator  owns the schema and runs migrations (DDL).
--   club_app       is what the web app uses at runtime: data access only, no DDL.
-- Passwords here are for the local Docker container only.

CREATE ROLE club_migrator LOGIN PASSWORD 'migrator_local_only';
CREATE ROLE club_app LOGIN PASSWORD 'app_local_only';

CREATE DATABASE club_booking OWNER club_migrator;
CREATE DATABASE club_booking_test OWNER club_migrator;

\connect club_booking
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO club_app;
ALTER DEFAULT PRIVILEGES FOR ROLE club_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO club_app;
ALTER DEFAULT PRIVILEGES FOR ROLE club_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO club_app;

\connect club_booking_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO club_app;
ALTER DEFAULT PRIVILEGES FOR ROLE club_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO club_app;
ALTER DEFAULT PRIVILEGES FOR ROLE club_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO club_app;
