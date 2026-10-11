-- 012_migrate_tipo_to_afip_integer_codes.sql
-- conciliacion-periodica T14 (RF-14): resolves a real, previously-invisible
-- gap found while designing stock-historico-comprobantes.spec.md.
--
-- Two incompatible "tipo de comprobante" encodings existed side by side:
--   - The one every real adapter/normalizer/matching-engine actually uses
--     (column-adapters.ts, afip-tipo-lookup.ts, comprobante-normalizer.ts,
--     CanonicalVoucher.tipo_cbte in shared-types): the real AFIP integer
--     "Tabla de Comprobantes" codes (1=Factura A, 6=Factura B, 11=Factura C,
--     3/8/13=Notas de Credito, etc).
--   - `afip_tipo_map.tipo` / `vouchers_canonical.tipo` (002/004, from
--     T01/T02, written before any real adapter existed): a zero-padded
--     3-digit legacy scheme ('001', '003', '004', ...) that was never wired
--     to anything real.
--
-- This never caused a bug because vouchers_canonical was never populated
-- (see openspec/progress/PR-3.md, Deviations #2) -- confirmed via grep that
-- no live code path reads/writes vouchers_canonical or afip_tipo_map today
-- (only a test-helper DELETE touches vouchers_canonical). Safe to redesign
-- destructively rather than write a data-preserving migration.
--
-- Replaces both tables' tipo columns with the real integer scheme, so
-- conciliacion-periodica's persistent stock (vouchers_canonical) can use
-- the exact same tipo_cbte values the normalizer already produces, with no
-- translation step.

-- CASCADE: reconciliation_results.voucher_canonical_id (005) has a FK into
-- vouchers_canonical(id). That column was never actually populated (009's
-- comment: T10 stores both sides' full canonical voucher JSON directly on
-- the result row instead of using this FK), so dropping the constraint
-- along with the table is safe -- the column itself stays on
-- reconciliation_results, just without the FK.
DROP TABLE IF EXISTS vouchers_canonical CASCADE;
DROP TABLE IF EXISTS afip_tipo_map CASCADE;

-- afip_tipo_map: real AFIP integer codes. `codigo` values must stay in sync
-- with afip-tipo-lookup.ts's KNOWN_AFIP_CODES (which now imports this same
-- set from shared-types' AFIP_TIPOS_CADENCIAL -- single source of truth).
CREATE TABLE afip_tipo_map (
  codigo      INTEGER PRIMARY KEY,
  descripcion TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- vouchers_canonical: normalized comprobantes, keyed by the real AFIP tipo
-- integer this time. estado/periodo_* columns are added by
-- 015_alter_vouchers_canonical_add_estado_periodo.sql (T21) -- this
-- migration only fixes the tipo encoding, kept as its own reviewable step.
CREATE TABLE vouchers_canonical (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  fecha         DATE,
  tipo_cbte     INTEGER NOT NULL REFERENCES afip_tipo_map(codigo),
  cuit_emisor   VARCHAR(11) NOT NULL,
  punto_venta   INT NOT NULL,
  numero        INT NOT NULL,
  importe_total NUMERIC(15,2),
  iva           FLOAT,
  file_source   TEXT NOT NULL CHECK (file_source IN ('arca', 'contabilidad')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vouchers_tenant_key
  ON vouchers_canonical (tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero);

CREATE INDEX idx_vouchers_tenant_cuit
  ON vouchers_canonical (tenant_id, cuit_emisor);
