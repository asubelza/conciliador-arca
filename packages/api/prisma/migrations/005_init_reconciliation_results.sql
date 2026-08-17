-- 005_init_reconciliation_results.sql
-- reconciliation_results: 5-category classification output per RF-09.
-- tipo_clasificacion is one of: matched | unmatched-arca | unmatched-contabilidad
-- | duplicates | errors.

CREATE TABLE reconciliation_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  voucher_canonical_id UUID REFERENCES vouchers_canonical(id),
  arca_row             JSONB,
  tipo_clasificacion   TEXT NOT NULL,
  iva_impacto          NUMERIC(15,2),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recon_tenant ON reconciliation_results (tenant_id);
CREATE INDEX idx_recon_tenant_class
  ON reconciliation_results (tenant_id, tipo_clasificacion, iva_impacto DESC);
