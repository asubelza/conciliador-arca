-- 004_init_voucher_canonical.sql
-- vouchers_canonical: normalized comprobantes. composite lookup key is
-- (tenant_id, cuit_emisor, tipo, punto_venta, numero) — tenant_id leading
-- on every index per the multi-tenant design.

CREATE TABLE vouchers_canonical (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  fecha         DATE,
  tipo          CHAR(3) NOT NULL REFERENCES afip_tipo_map(tipo),
  cuit_emisor   VARCHAR(11) NOT NULL,
  punto_venta   INT NOT NULL,
  numero        INT NOT NULL,
  importe_total NUMERIC(15,2),
  iva           FLOAT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compound lookup index: tenant_id leading, then the AFIP composite key.
CREATE INDEX idx_vouchers_tenant_key
  ON vouchers_canonical (tenant_id, cuit_emisor, tipo, punto_venta, numero);

CREATE INDEX idx_vouchers_tenant_cuit
  ON vouchers_canonical (tenant_id, cuit_emisor);
