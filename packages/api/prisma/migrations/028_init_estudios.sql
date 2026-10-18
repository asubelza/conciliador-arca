-- 028_init_estudios.sql
-- First piece of the multi-estudio pivot (see
-- idempotent-coalescing-rivest.md's "Migraciones" section): today the app is
-- a single accounting firm's internal tool — `tenants` are that one firm's
-- client-empresas, and `admin`/`colaborador` implicitly span every tenant
-- (001_init_tenants.sql, 018_init_users_and_roles.sql). This introduces
-- `estudios` as the new top level: other accounting firms will get their own
-- `estudios` row, and every `tenants` row will belong to exactly one
-- `estudio` (029_alter_tenants_add_estudio_id.sql adds that FK).
--
-- `estudios` itself has no FK of its own — it IS the new top level, nothing
-- sits above it (a later PR may add a separate platform-staff concept, but
-- that is users.estudio_id IS NULL, not a table this one references).
--
-- Same shape/style as `tenants` (001_init_tenants.sql) plus the `active`
-- toggle `tenants` got in 027_alter_tenants_add_active.sql, so an estudio can
-- be disabled without deleting it — same "deactivate, never delete"
-- discipline as `tenants`/`users` already use.
CREATE TABLE estudios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same least-privilege discipline as tenants/users: no DELETE, matching the
-- "deactivate via `active`, never delete" posture.
GRANT SELECT, INSERT, UPDATE ON estudios TO app_role;
