-- 006_init_audit_trail.sql
-- audit_trail: immutable append-only event log (upload/normalize/match/export/user_mark).

CREATE TABLE audit_trail (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_trail (tenant_id);
