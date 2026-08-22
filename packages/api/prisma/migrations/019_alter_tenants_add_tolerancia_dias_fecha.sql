-- 019_alter_tenants_add_tolerancia_dias_fecha.sql
-- RF-13 (matching-similitud): a second per-tenant tolerance, this time on
-- date, alongside the amount tolerance 014 already added
-- (tolerancia_redondeo_ars). Same pattern deliberately: configurable per
-- tenant (client chose this explicitly when asked, same as they chose "por
-- tenant" over "global" for the amount tolerance during
-- conciliacion-periodica).
--
-- Only used by the similarity-matching fallback (RF-04) — the composite-key
-- exact match (periodo-matching-engine.ts's `buildCompositeKey`) never
-- looks at fecha at all, so this tolerance has no effect there. Default 5
-- days: enough to absorb "cargó el comprobante un par de días distinto de
-- la fecha real de ARCA" without being so wide it starts pairing unrelated
-- vouchers from the same emisor.
ALTER TABLE tenants
  ADD COLUMN tolerancia_dias_fecha INT NOT NULL DEFAULT 5
    CHECK (tolerancia_dias_fecha >= 0 AND tolerancia_dias_fecha <= 365);
