-- 016_init_periodo_resultados.sql
-- T27/T28 (RF-20/RF-21, conciliacion-periodica): the frozen snapshot a
-- período's "Cerrar Conciliación del Mes" writes once, at close time.
--
-- This is deliberately a NEW table, not a reuse of `reconciliation_results`
-- (005_init_reconciliation_results.sql): that table is job-scoped
-- (`job_id`) and carries the *job-level* 5-category taxonomy (matched /
-- unmatched-arca / unmatched-contabilidad / duplicates / errors) from
-- RF-08/RF-09 — unrelated to a período's 5-category matching taxonomy
-- (conciliado_ok / con_divergencia / posible_duplicado_en_sistema /
-- no_existe_en_arca / pendiente_en_arca) computed by
-- periodo-matching-engine.ts. Mixing the two into one table would force one
-- CHECK constraint to cover both vocabularies and one report-generator to
-- branch on which scope it's reading. See reconciliation-reporting-periodica
-- .spec.md's module doc ("Modifies") — the per-job report/export endpoints
-- (T11/T13) are explicitly unchanged.
--
-- RF-20(4)/RF-21: written exactly once per período, inside the same
-- transaction that flips `periodos.estado` to 'cerrado' (see
-- periodo-cierre.ts) — never touched again afterward, same append-only
-- guarantee `audit_trail` already has (006_init_audit_trail.sql +
-- 007_enable_rls.sql's REVOKE pattern).

CREATE TABLE periodo_resultados (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  periodo_id       UUID NOT NULL REFERENCES periodos(id),
  classification   TEXT NOT NULL CHECK (classification IN (
                      'conciliado_ok',
                      'con_divergencia',
                      'posible_duplicado_en_sistema',
                      'no_existe_en_arca',
                      'pendiente_en_arca'
                    )),
  composite_key    TEXT NOT NULL,
  sistema_row      JSONB,
  arca_row         JSONB,
  delta            NUMERIC(15,2),
  antiguedad_meses INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_periodo_resultados_periodo ON periodo_resultados (periodo_id);
CREATE INDEX idx_periodo_resultados_tenant ON periodo_resultados (tenant_id);

ALTER TABLE periodo_resultados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON periodo_resultados
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Append-only once written at cierre. Note (same scope caveat as
-- 011_grant_app_role_audit_feedback.sql): app_role has no GRANT of its own
-- yet on most tables including this one, so in practice every connection in
-- this environment is the superuser `conciliador` and bypasses this check
-- entirely — flagged again here, not newly introduced by this migration.
REVOKE UPDATE, DELETE ON periodo_resultados FROM app_role;
