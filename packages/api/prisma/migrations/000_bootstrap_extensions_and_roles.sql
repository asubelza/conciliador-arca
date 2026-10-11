-- 000_bootstrap_extensions_and_roles.sql
-- Bootstrap prerequisites for migrations 001-007 on a fresh PostgreSQL instance:
--   1. `gen_random_uuid()` (used as the PK default across every table) is provided
--      by the pgcrypto extension, not by PostgreSQL core, so it must be enabled
--      before any CREATE TABLE that references it.
--   2. `app_role` is the least-privilege role the application connects as. It
--      must exist before 007_enable_rls.sql runs `REVOKE UPDATE, DELETE ON
--      audit_trail FROM app_role`, which otherwise fails with
--      "role app_role does not exist" on a database that has never been
--      provisioned outside these migrations (e.g. a fresh Railway/Render DB).
--
-- Found during PR-1 review (see openspec/progress/PR-1.md, "Risks found in review").

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Created NOLOGIN: this migration only needs the role to exist so the REVOKE
-- in 007 has a target. Granting LOGIN/password (or GRANT app_role TO <api_user>)
-- is an infra/deploy concern, not something migrations should hardcode.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
END
$$;
