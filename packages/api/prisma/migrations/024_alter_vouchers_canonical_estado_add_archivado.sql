-- 024_alter_vouchers_canonical_estado_add_archivado.sql
-- Histórico filters + "Archivar" (client request, 2026-10-12, dashboard
-- feedback): the contador wants to mark a pendiente ARCA voucher from the
-- "Histórico de Pendientes en ARCA" screen (PendientesHistoricoViewer.tsx)
-- as "no longer relevant" — not matched to anything, but also not a real
-- `conciliado` resolution (resolverPendienteArca's existing action already
-- covers that case). This third terminal `estado` value, 'archivado', means
-- "deliberately excluded from all future matching, by human decision" —
-- distinct from 'conciliado' (matched or manually resolved) so a report can
-- still tell the two apart later if that's ever needed.
--
-- Scope note: this migration ONLY widens the CHECK constraint and touches
-- no rows — nothing in this change writes 'archivado' automatically (e.g.
-- no auto-archive-by-age rule). That's explicitly deferred to a later,
-- undefined iteration; this migration just makes the value a legal `estado`
-- for the new archive endpoints (comprobante-arca-archivar.ts) to set.
--
-- Postgres has no ALTER CONSTRAINT for a CHECK's expression — the existing
-- constraint must be dropped and recreated with the widened list, same
-- idiom as 021_alter_periodo_resultados_add_posible_coincidencia.sql. Unlike
-- that migration, 015_alter_vouchers_canonical_add_estado_periodo.sql added
-- this CHECK inline on the column (`ADD COLUMN estado TEXT NOT NULL DEFAULT
-- 'pendiente' CHECK (...)`) rather than as a separately named table
-- constraint, so Postgres auto-named it; `vouchers_canonical_estado_check`
-- is the standard <table>_<column>_check naming Postgres assigns in that
-- case.
ALTER TABLE vouchers_canonical
  DROP CONSTRAINT IF EXISTS vouchers_canonical_estado_check;

ALTER TABLE vouchers_canonical
  ADD CONSTRAINT vouchers_canonical_estado_check CHECK (estado IN ('pendiente', 'conciliado', 'archivado'));
