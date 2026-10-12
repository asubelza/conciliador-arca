-- 021_alter_periodo_resultados_add_posible_coincidencia.sql
-- RF-04 (matching por similitud): periodo-matching-engine.ts gains a 6th
-- classification, 'posible_coincidencia' (a similarity candidate the
-- contador hasn't confirmed/descartado yet via
-- 020_init_fuzzy_match_confirmations.sql). If a período closes with one
-- still unconfirmed, it freezes into periodo_resultados exactly like any
-- other leftover classification (periodo-cierre.ts's insertResultadosSnapshot
-- already writes whatever `results` contains, no special-casing needed
-- there) — this migration just widens the CHECK to accept the new value and
-- adds a column to carry the human-readable reason the live view computes
-- (`similarity_reason`, e.g. "número difiere en 1 dígito: 1234 vs 1235"),
-- so a closed período's frozen "Posible Coincidencia" rows still explain
-- themselves (RNF-07/08) instead of just showing two bare rows with no
-- context.
ALTER TABLE periodo_resultados
  DROP CONSTRAINT periodo_resultados_classification_check;

ALTER TABLE periodo_resultados
  ADD CONSTRAINT periodo_resultados_classification_check CHECK (classification IN (
    'conciliado_ok',
    'con_divergencia',
    'posible_duplicado_en_sistema',
    'no_existe_en_arca',
    'pendiente_en_arca',
    'posible_coincidencia'
  ));

ALTER TABLE periodo_resultados ADD COLUMN similarity_reason TEXT;
