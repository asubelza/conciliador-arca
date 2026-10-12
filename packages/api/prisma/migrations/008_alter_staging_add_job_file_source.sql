-- 008_alter_staging_add_job_file_source.sql
-- T05 (RF-03): the T02 vouchers_staging migration (003) only had
-- (id, tenant_id, raw_data, created_at) — it never carried job_id or
-- file_source, even though architecture.md's proposed schema and
-- voucher-ingestion.spec.md's staging table both require them: the status
-- endpoint (T06) needs to scope rows to one job, and RF-03's own acceptance
-- criteria requires "file_source column is set to 'arca'/'contabilidad' for
-- each row". This was missed in T02 and is corrected here rather than by
-- editing migration 003, since migrations already applied elsewhere must
-- stay append-only.
--
-- Deviation from voucher-ingestion.spec.md: the spec's data-schema section
-- names this column `row_data`; the real table (003_init_voucher_staging.sql)
-- already named it `raw_data`. Kept `raw_data` for continuity with the
-- existing column rather than renaming a column already in use by T02/T03.

ALTER TABLE vouchers_staging
  ADD COLUMN job_id UUID,
  ADD COLUMN file_source TEXT NOT NULL DEFAULT 'arca';

ALTER TABLE vouchers_staging
  ADD CONSTRAINT chk_staging_file_source CHECK (file_source IN ('arca', 'contabilidad'));

ALTER TABLE vouchers_staging
  ALTER COLUMN file_source DROP DEFAULT;

CREATE INDEX idx_staging_job ON vouchers_staging (job_id);
