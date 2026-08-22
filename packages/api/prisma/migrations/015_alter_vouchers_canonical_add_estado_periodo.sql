-- 015_alter_vouchers_canonical_add_estado_periodo.sql
-- conciliacion-periodica T21 (RF-15/RF-16): turns vouchers_canonical from
-- an unused table (see openspec/progress/PR-3.md, Deviations #2) into the
-- real persistent stock the 3-step matching engine reads/writes.
--
-- estado: 'pendiente' (default, matches the state diagram in
-- openspec/designs/conciliacion-periodica/architecture.md — every voucher
-- starts pendiente on first upsert) or 'conciliado' (terminal, set only by
-- "Cerrar Mes", T27/Phase 3 — immutable once set, see RF-15's third
-- scenario and vouchers-canonical-writer.ts's upsert WHERE clause).
--
-- periodo_alta_id: the período a row was first upserted in (ARCA side) or
-- most recently touched in (contabilidad side) — see
-- vouchers-canonical-writer.ts's module doc for why the two sides treat
-- this column differently. Drives RF-19's antiguedad_meses for pendiente
-- ARCA stock.
--
-- periodo_cierre_id: the período a row was marked conciliado in (T27,
-- Phase 3 — nullable here because nothing sets it yet).
--
-- idx_vouchers_tenant_key_unique is the real enforcement for RF-15's
-- "re-upload updates, not duplicates" requirement — replaces the old
-- non-unique idx_vouchers_tenant_key from 004_init_voucher_canonical.sql
-- (kept alongside it; a superset covering index isn't worth the migration
-- risk of dropping/recreating the original for this PR).

ALTER TABLE vouchers_canonical
  ADD COLUMN estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'conciliado')),
  ADD COLUMN periodo_alta_id   UUID REFERENCES periodos(id),
  ADD COLUMN periodo_cierre_id UUID REFERENCES periodos(id);

CREATE UNIQUE INDEX idx_vouchers_tenant_key_unique
  ON vouchers_canonical (tenant_id, file_source, cuit_emisor, tipo_cbte, punto_venta, numero);

CREATE INDEX idx_vouchers_tenant_estado ON vouchers_canonical (tenant_id, file_source, estado);
