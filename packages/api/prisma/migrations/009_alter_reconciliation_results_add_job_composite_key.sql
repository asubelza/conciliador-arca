-- 009_alter_reconciliation_results_add_job_composite_key.sql
-- T10 (RF-09): reconciliation_results (005) was missing columns the
-- matching/classification engine and T11's reporting both need:
--   - job_id: scope results to one upload/reconciliation run (T06's status
--     endpoint and T11's report endpoint are both job_id-scoped; without
--     this, results from different runs for the same tenant are
--     indistinguishable).
--   - composite_key: the AFIP composite key text (RF-08's
--     "cuit_emisor|tipo_cbte|punto_venta|numero"), needed to look up a
--     result by key (T12's user-marking flow) without re-deriving it from
--     arca_row/contabilidad_row every time.
--   - contabilidad_row: architecture.md's proposed schema has separate
--     arca_id/contabilidad_id FKs into vouchers_canonical; 005 only ever
--     added arca_row (JSONB). Rather than also standing up a populated
--     vouchers_canonical table (which would require bridging
--     CanonicalVoucher.tipo_cbte, an AFIP integer, down to
--     vouchers_canonical.tipo, a zero-padded 3-digit storage code with no
--     defined mapping yet — see afip-tipo-lookup.ts's module doc), T10
--     stores both sides' full canonical voucher JSON directly on the
--     result row. This is a deliberate scope decision: nothing in T10-T13's
--     acceptance criteria requires querying vouchers_canonical separately
--     from reconciliation_results.

ALTER TABLE reconciliation_results
  ADD COLUMN job_id UUID,
  ADD COLUMN composite_key TEXT,
  ADD COLUMN contabilidad_row JSONB;

CREATE INDEX idx_recon_job ON reconciliation_results (job_id);
CREATE INDEX idx_recon_tenant_composite_key ON reconciliation_results (tenant_id, composite_key);
