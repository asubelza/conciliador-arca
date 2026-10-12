-- 022_seed_afip_tipo_map_15_51_81.sql
-- Fixes a real production-blocking bug reported by the user (2026-08-23):
-- "insert or update on table vouchers_canonical violates foreign key
-- constraint vouchers_canonical_tipo_cbte_fkey".
--
-- Root cause: commit 4ee85e7 (same day) added AFIP codes 15 (Recibo C), 51
-- (Factura A con leyenda "Operación Sujeta a Retención", RG 5762/2025 — see
-- shared-types' AFIP_TIPOS_CADENCIAL doc comment) and 81 (Tique-Factura A)
-- to shared-types' AFIP_TIPOS_CADENCIAL, which drives tipo_cbte RESOLUTION
-- at the adapter/normalizer layer (column-adapters.ts / afip-tipo-lookup.ts)
-- — that layer was verified thoroughly (995/995 real-file resolution,
-- 459/459 tests, clean builds). What was missed: 012_migrate_tipo_to_afip_
-- integer_codes.sql's afip_tipo_map table is the target of a real Postgres
-- FOREIGN KEY on vouchers_canonical.tipo_cbte, and that commit never
-- inserted rows for the 3 new codes into afip_tipo_map itself. So any real
-- reconciliation job hitting a row with tipo_cbte 15/51/81 now normalizes
-- correctly in application code but fails at INSERT time against the
-- database's own FK constraint. seed.ts/seed-runner.ts (which derives its
-- INSERT from the same AFIP_TIPOS_CADENCIAL/AFIP_TIPO_LABELS) would also
-- produce the right rows, but only runs once at bootstrap on an empty table
-- and is not safely re-runnable (no ON CONFLICT — see seed.test.ts's
-- documented PK-conflict-on-rerun behavior, swallowed by docker-compose's
-- `|| true`), so it cannot be relied on to backfill an already-seeded,
-- already-running database. A migration is the correct fix vector: it is
-- tracked in schema_migrations (won't re-run), and migrate-runner failures
-- are fatal/visible (unlike seed-runner's), so this is safe to apply to any
-- database regardless of whether it already ran the old 12-row seed.
--
-- ON CONFLICT DO NOTHING makes this idempotent regardless of the target
-- database's current state (already has some/all of these 3 codes, or
-- none) — verified against a real Postgres instance carrying the pre-fix
-- 12-row afip_tipo_map (see estado_dev_y_revision_pr1.md for the full
-- verification: reproduced the exact FK violation first, applied this
-- migration, then successfully inserted vouchers_canonical rows with
-- tipo_cbte 15/51/81, and re-ran this file a second time with no error).
INSERT INTO afip_tipo_map (codigo, descripcion, activo) VALUES
  (15, 'RECIBO_C', TRUE),
  (51, 'FACTURA_A_LEYENDA_RETENCION', TRUE),
  (81, 'TIQUE_FACTURA_A', TRUE)
ON CONFLICT (codigo) DO NOTHING;
