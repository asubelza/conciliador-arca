-- 018_init_users_and_roles.sql
-- T33 (RF-14, openspec/proposal/autenticacion-roles.md): users + roles.
-- Closes a real gap flagged 2026-08-22: until this migration the API had
-- zero access control — no auth dependency installed at all (see main.ts's
-- own comment acknowledging this). RLS by tenant_id protects data only if
-- the correct tenant_id reaches the query; nothing stopped a caller from
-- passing any tenant_id and reading that tenant's data.
--
-- No RLS/tenant_isolation policy here, same as `tenants` itself
-- (001_init_tenants.sql): `users` has no tenant_id column (a single
-- estudio's users implicitly span every tenant, see architecture.md's "Por
-- qué no hay tabla estudios"), and `user_tenant_access` — despite having a
-- tenant_id column — is the table that DECIDES tenant access in the first
-- place, so it must be queryable before `app.tenant_id` is ever set; RLS
-- would create a chicken-and-egg problem.

-- email is always stored lowercase (CHECK below) so lookups can normalize
-- the input with a plain lower() and never miss a row on case alone —
-- login()/auth.service.ts and every account-creation path must lower() the
-- value before it reaches an INSERT.
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'colaborador', 'cliente')),
  display_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only meaningful for role='cliente' — admin/colaborador see every tenant
-- implicitly and never need a row here (architecture.md).
CREATE TABLE user_tenant_access (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX idx_user_tenant_access_user ON user_tenant_access (user_id);

-- app_role grants, same least-privilege discipline as migration 017. No
-- DELETE on users (deactivate via is_active, keeps historical references
-- like periodos.cerrado_por meaningful even for an ex-employee). DELETE is
-- fine on user_tenant_access: revoking a client's access to a tenant is a
-- normal, expected admin action, and the row carries no other data to lose.
GRANT SELECT, INSERT, UPDATE ON users TO app_role;
GRANT SELECT, INSERT, DELETE ON user_tenant_access TO app_role;
