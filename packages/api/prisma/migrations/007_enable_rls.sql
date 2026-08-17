-- 007_enable_rls.sql
-- Row-Level Security as the tenant-isolation BACKSTOP.
-- App-layer tenant_id scoping is the PRIMARY gate (see architecture.md Security).
-- RLS here ensures no query can bypass tenant scoping even if the app forgets.

ALTER TABLE vouchers_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers_canonical ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON vouchers_staging
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY "tenant_isolation" ON vouchers_canonical
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY "tenant_isolation" ON reconciliation_results
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY "tenant_isolation" ON audit_trail
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- audit_trail is append-only: the application role cannot UPDATE or DELETE.
REVOKE UPDATE, DELETE ON audit_trail FROM app_role;
