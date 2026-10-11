-- 011_grant_app_role_audit_feedback.sql
-- T12 (RF-11): `app_role` (000_bootstrap_extensions_and_roles.sql) was
-- created NOLOGIN with no privileges of its own — 007_enable_rls.sql's
-- `REVOKE UPDATE, DELETE ON audit_trail FROM app_role` only removes
-- privileges the role never actually had, so as written, app_role could not
-- even INSERT into audit_trail. Discovered while writing a real (not just
-- structural/regex-on-SQL-text) test for RF-11 AC4 that adopts app_role via
-- `SET ROLE` and tries an INSERT as a control case alongside the blocked
-- UPDATE/DELETE (see audit-logger.test.ts) — the INSERT failed with
-- "permission denied for table audit_trail" before this migration existed.
--
-- Grants the minimum app_role needs for the append-only design to actually
-- work: SELECT + INSERT (never UPDATE/DELETE, which stay revoked) on
-- audit_trail, and SELECT + INSERT on feedback_loop (the app only ever
-- inserts new marks and reads them back — see feedback-writer.ts; it never
-- updates or deletes an existing mark).
--
-- Scope note: every other table (vouchers_staging, vouchers_canonical,
-- reconciliation_results, tenants, afip_tipo_map) has this same
-- missing-GRANT gap for app_role — invisible so far because every
-- migration/test/dev session in this environment connects as a superuser
-- (`conciliador`), which bypasses privilege checks entirely. Fixing that for
-- every table is a real pre-deploy task, but it's outside T12's scope
-- (audit_trail + feedback_loop); flagged here for the final progress
-- write-up rather than silently expanded into a full grants audit.

GRANT SELECT, INSERT ON audit_trail TO app_role;
GRANT SELECT, INSERT ON feedback_loop TO app_role;
