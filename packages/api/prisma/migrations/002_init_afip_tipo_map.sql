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

CREATE INDEX idx_afip_tipo ON afip_tipo_map (tipo);
