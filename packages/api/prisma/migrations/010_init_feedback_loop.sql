-- 010_init_feedback_loop.sql
-- T12 (RF-11): feedback_loop stores user marks (revisado/explicado) on a
-- reconciliation result. Keyed by `composite_key` (not a specific
-- reconciliation_results.id) so a mark survives across re-runs of the same
-- reconciliation for the same source data — RF-11's "Feedback loop persists
-- for future matching" scenario reads feedback_loop by composite_key, not
-- by job_id, since a new upload gets a brand-new job_id but the same
-- composite_key.
--
-- user_id is UUID (not the spec doc's literal `text`) to match
-- audit_trail.user_id (006_init_audit_trail.sql) — both tables represent
-- the same "who did this" identity and should agree on its type. There is
-- still no auth/Clerk integration (documented gap — see
-- upload-validation.ts's validateTenantId comment), so both stay nullable,
-- trusted client input for the MVP.
--
-- Unlike audit_trail, feedback_loop is NOT append-only: RF-11's acceptance
-- criteria only require audit_trail immutability (AC4); nothing requires
-- marks to be un-editable, so no REVOKE is applied here.

CREATE TABLE feedback_loop (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  user_id        UUID,
  composite_key  TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('revisado', 'explicado')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_tenant_key ON feedback_loop (tenant_id, composite_key, created_at DESC);

ALTER TABLE feedback_loop ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON feedback_loop
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
