-- 003_init_voucher_staging.sql
-- vouchers_staging: unindexed, ephemeral per-job raw rows. COPY FROM STDIN
-- target (per design). No business indexes; dropped/rebuilt around load.

CREATE TABLE vouchers_staging (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  raw_data   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staging_tenant ON vouchers_staging (tenant_id);
