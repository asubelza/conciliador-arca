-- 020_init_fuzzy_match_confirmations.sql
-- RF-04 (matching por similitud): periodo-matching-engine.ts's fuzzy fallback
-- (used only when the composite-key exact match finds nothing) never
-- auto-classifies a similarity candidate as conciliado on its own — RNF-07
-- ("toda salida de IA/heurística debe presentarse como sugerencia a
-- validar, no como conclusión automática") requires a human decision first.
-- This table IS that decision, once made:
--
--   'confirmado' — the contador confirmed sistema_voucher_id and
--     arca_voucher_id are the same real comprobante. From then on,
--     matchPeriodo treats this pair as a match (same delta/tolerance logic
--     as an exact composite-key match), consuming both rows, exactly as if
--     the key had matched in the first place.
--   'descartado' — the contador looked at the suggested pair and rejected
--     it. matchPeriodo stops suggesting this specific pair again (the two
--     rows fall back to whatever their default classification would be:
--     no_existe_en_arca / pendiente_en_arca).
--
-- Both directions are explicit, auditable rows here — never a silent
-- "don't ask again" flag buried in application state. One row per pair
-- (PK), decision is upsertable (the contador can change their mind).
CREATE TABLE fuzzy_match_confirmations (
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  sistema_voucher_id UUID NOT NULL REFERENCES vouchers_canonical(id),
  arca_voucher_id    UUID NOT NULL REFERENCES vouchers_canonical(id),
  status            TEXT NOT NULL CHECK (status IN ('confirmado', 'descartado')),
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sistema_voucher_id, arca_voucher_id)
);

CREATE INDEX idx_fuzzy_confirmations_tenant ON fuzzy_match_confirmations (tenant_id);

ALTER TABLE fuzzy_match_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON fuzzy_match_confirmations
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Upsertable (ON CONFLICT ... DO UPDATE when the contador changes their
-- decision), so app_role needs UPDATE here unlike the INSERT-only pattern
-- used for append-only tables (audit_trail, periodo_resultados).
GRANT SELECT, INSERT, UPDATE ON fuzzy_match_confirmations TO app_role;
