-- 025_init_user_invites.sql
-- Backoffice self-service (invitación por email, "Backoffice de tenants y
-- usuarios" plan): an admin creates a user row directly (is_active =
-- false, throwaway password_hash — see users.service.ts's module doc) and
-- this table tracks the single-use link that lets that user set their own
-- password and activate the account.
--
-- token_hash stores SHA-256 of the raw token (crypto.randomBytes(32), see
-- invite-tokens.ts) — never the raw token itself, same "never store the
-- secret you can look up by" posture as password_hash, but SHA-256 (not
-- bcrypt) because lookups need deterministic equality (WHERE token_hash =
-- $1), not a salted comparison.
--
-- Single-use via consumed_at: accepting the invite marks it in the same
-- transaction that activates the user. Resending an invite invalidates
-- (marks consumed_at on) any still-valid invite for that user first, so at
-- most one valid invite ever exists per user at a time.
--
-- No tenant_id, no RLS — same posture as users/user_tenant_access
-- (018_init_users_and_roles.sql): this table is read/written before any
-- tenant scoping is resolved.
CREATE TABLE user_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_invites_user ON user_invites (user_id);

-- No DELETE — same "deactivate, never delete" discipline as users (018):
-- an invite is invalidated by setting consumed_at, never removed.
GRANT SELECT, INSERT, UPDATE ON user_invites TO app_role;
