-- 002_init_afip_tipo_map.sql
-- afip_tipo_map: AFIP comprobante tipo catalogue. Seeded with the 15 canonical
-- tipos from packages/shared-types via prisma/seed.ts (T03).
-- `tipo` is a zero-padded 3-digit code (e.g. '001') shared with vouchers_canonical.tipo.

CREATE TABLE afip_tipo_map (
  id          SERIAL PRIMARY KEY,
  tipo        CHAR(3) NOT NULL,
  descripcion TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE (not just indexed): 004_init_voucher_canonical.sql declares
-- `tipo REFERENCES afip_tipo_map(tipo)`, and Postgres requires the
-- referenced column to be backed by a unique index/constraint for a FK to
-- be creatable at all. This never ran against a real Postgres before this
-- fix (see openspec/progress/PR-1.md deviation #1 — no Postgres was
-- available), so the gap was never caught; found and fixed 2026-08-21 the
-- first time these migrations actually ran end to end against real PG.
CREATE UNIQUE INDEX idx_afip_tipo ON afip_tipo_map (tipo);
