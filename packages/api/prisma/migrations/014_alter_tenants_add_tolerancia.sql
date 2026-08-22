-- 014_alter_tenants_add_tolerancia.sql
-- conciliacion-periodica T17: per-tenant amount-comparison tolerance
-- (RF-18) — the client's functional spec calls for a rounding tolerance on
-- amount matching, and the user chose "por tenant" (configurable per tenant,
-- not global/hardcoded) when this was asked via AskUserQuestion during the
-- conciliacion-periodica proposal review (2026-08-22).
--
-- Default 0.99 (ARS) matches the client's own example in the functional
-- spec of a sub-peso rounding difference that should still count as a match.
-- `GET/PUT /api/tenants/:id/config` (T20) reads/writes this column.

ALTER TABLE tenants ADD COLUMN tolerancia_redondeo_ars NUMERIC(10,2) NOT NULL DEFAULT 0.99;
