-- 013_init_periodos.sql
-- conciliacion-periodica T16 (RF-12/RF-13): a "período" (calendar month, per
-- tenant) is the new unit a reconciliation upload belongs to, replacing the
-- old model where an upload was only ever scoped to an isolated job_id.
-- `UNIQUE (tenant_id, mes)` is the real enforcement for RF-12's "reject a
-- duplicate período for the same tenant + month" scenario — app-layer
-- validation alone is not sufficient under concurrent requests.
--
-- `mes` is always normalized to the 1st of the month by the INSERT itself
-- (`date_trunc('month', ...)` in periodos.controller.ts), so any day-of-month
-- a caller sends collapses onto the same row.
--
-- `tolerancia_ars` is nullable and stays NULL while the período is abierto —
-- RF-21 snapshots the tenant's current tolerance onto this column only at
-- cierre (see cierre-de-mes.spec.md), so it is an auditable record of what
-- tolerance was actually applied, not a live mirror of tenants.tolerancia_redondeo_ars.
--
-- RLS follows the same tenant-isolation pattern as vouchers_canonical /
-- reconciliation_results / audit_trail (007_enable_rls.sql) — periodos is
-- tenant-scoped data of the same kind. Note (same caveat as
-- 011_grant_app_role_audit_feedback.sql's "Scope note"): no app code sets
-- app.tenant_id yet and every migration/test session connects as the
-- superuser, so this policy is currently dormant/aspirational like the
-- others — added for consistency, not a claim that RLS is actively enforced
-- today.

CREATE TABLE periodos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  mes            DATE NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  tolerancia_ars NUMERIC(10,2),
  cerrado_at     TIMESTAMPTZ,
  cerrado_por    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mes)
);

CREATE INDEX idx_periodos_tenant_estado ON periodos (tenant_id, estado);

ALTER TABLE periodos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON periodos
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
