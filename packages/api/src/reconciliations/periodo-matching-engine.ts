/**
 * periodo-matching-engine.ts — T23–T26 (RF-16–RF-19,
 * openspec/specs/conciliacion-periodica/matching-periodico.spec.md): the
 * 3-step match against a período's persistent `vouchers_canonical` stock,
 * replacing the single-pass two-ephemeral-lists match
 * (`reconciliation-engine.ts`, still used as-is for the per-job RF-08/RF-09
 * report — this module is additive, not a replacement of that one).
 *
 * Algorithm (see openspec/designs/conciliacion-periodica/architecture.md,
 * "Algoritmo de Matching"):
 *
 *   sistema_rows            = contabilidad-side rows loaded THIS período
 *   arca_corriente           = arca-side rows loaded THIS período (not conciliado)
 *   arca_pendiente_historico = arca-side pendiente rows from OTHER períodos
 *
 *   for each sistema row: probe arca_corriente first (Match Corriente),
 *   then arca_pendiente_historico (Match Histórico). A match compares
 *   importe_total_ars within the tenant's tolerance (RF-18:
 *   'conciliado_ok' vs 'con_divergencia'). No match checks whether this
 *   composite key is already conciliado anywhere (RF-17:
 *   'posible_duplicado_en_sistema' vs 'no_existe_en_arca'). Leftover ARCA
 *   rows (corriente + histórico) not consumed by any sistema row are
 *   'pendiente_en_arca', with antiguedad_meses (RF-19).
 *
 * `estado = 'conciliado'` rows are excluded from every pool by construction
 * (the WHERE clauses below), never filtered out afterward — this is what
 * RF-16's "a conciliado voucher is never returned as a match candidate"
 * scenario requires.
 *
 * RF-04/RF-13 (matching por similitud, added after autenticacion-roles):
 * when a sistema row has NO exact composite-key match anywhere (corriente
 * or histórico), a further step now runs before settling on
 * 'no_existe_en_arca':
 *
 *   1. Confirmed pairing first — if the contador already confirmed
 *      (`fuzzy_match_confirmations.status = 'confirmado'`) that this
 *      sistema voucher is the same real comprobante as a specific ARCA
 *      voucher, that pairing is used exactly like an exact-key match (same
 *      delta/tolerance logic, consumes the ARCA row). No re-suggestion, no
 *      re-review needed on every report view.
 *   2. Otherwise, a similarity candidate is searched for among ARCA rows
 *      NOT already consumed by another sistema row this run — first a
 *      single-digit typo in `numero` (same cuit/tipo/punto_venta, exact
 *      fecha, importe within tolerance), then, if nothing found, fecha
 *      within `toleranciaDiasFecha` days + importe within tolerance
 *      (numero/punto_venta free). A found, non-`descartado` candidate
 *      becomes classification 'posible_coincidencia' with a
 *      human-readable `similarity_reason` — NEVER auto-promoted to
 *      conciliado_ok (RNF-07: "toda salida de IA/heurística... como
 *      sugerencia a validar, no como conclusión automática"). The
 *      candidate ARCA row is deliberately NOT consumed here — until
 *      confirmed, it still also appears as pendiente_en_arca /
 *      unconsumed-corriente, since nothing has actually resolved it yet.
 */
import type { Pool } from 'pg';

/**
 * T27 (conciliacion-periodica): `matchPeriodo` is called two ways — a
 * read-only live view (`Pool`, from the report endpoint on an open período)
 * and as part of `periodo-cierre.ts`'s single close transaction (a
 * `PoolClient`, so the match and the state-persisting writes it feeds run
 * against the same transaction, per RF-20's "within a single transaction").
 * Both expose a structurally-identical `query()`, so this module only
 * depends on that, not on the rest of either class's surface.
 */
type Queryable = Pick<Pool, 'query'>;

export type PeriodoClassification =
  | 'conciliado_ok'
  | 'con_divergencia'
  | 'posible_duplicado_en_sistema'
  | 'no_existe_en_arca'
  | 'pendiente_en_arca'
  | 'posible_coincidencia';

export type FuzzyConfirmationStatus = 'confirmado' | 'descartado';

export interface VoucherCanonicalRow {
  id: string;
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  importe_total: number | null;
  iva: number | null;
  fecha: string | null;
  file_source: 'arca' | 'contabilidad';
  estado: 'pendiente' | 'conciliado';
  periodo_alta_id: string;
}

export interface PeriodoMatchResult {
  classification: PeriodoClassification;
  composite_key: string;
  sistema?: VoucherCanonicalRow;
  arca?: VoucherCanonicalRow;
  /** RF-18: |sistema.importe_total - arca.importe_total|, only set for a found match. */
  delta?: number;
  /** RF-16: which pool the arca side was found in — reporting/debugging aid, not spec-required. */
  match_source?: 'corriente' | 'historico';
  /** RF-19: only set for 'pendiente_en_arca'. */
  antiguedad_meses?: number;
  /** RF-04: set when this match came from a confirmed similarity pairing rather than an exact composite-key match. */
  matched_via?: 'clave_exacta' | 'similitud_confirmada';
  /** RF-04: only set for 'posible_coincidencia' — a human-readable explanation of why these two rows were suggested as the same comprobante (RNF-07/08: every heuristic suggestion must explain itself). */
  similarity_reason?: string;
}

export type PeriodoMatchCounts = Record<PeriodoClassification, number>;

export interface PeriodoMatchSummary {
  results: PeriodoMatchResult[];
  counts: PeriodoMatchCounts;
}

/**
 * `cuit_emisor|tipo_cbte|punto_venta|numero`, same format as
 * reconciliation-engine.ts's `buildCompositeKey` (RF-08's composite key) —
 * re-declared here rather than reused because that one is typed against
 * `CanonicalVoucher` (packages/shared-types), which carries fields
 * (`fecha_emision`, `importe_total_ars`, `moneda`, `source_row`) this
 * row shape, read straight back from `vouchers_canonical`, doesn't have.
 */
function buildCompositeKey(v: { cuit_emisor: string; tipo_cbte: number; punto_venta: number; numero: number }): string {
  return `${v.cuit_emisor}|${v.tipo_cbte}|${v.punto_venta}|${v.numero}`;
}

/**
 * RF-04 similarity step 1 ("número con typo de 1 dígito"): both numbers
 * zero-padded to the same width, then a plain Hamming distance over the
 * digit positions — true only when exactly one digit differs (e.g. 1234 vs
 * 1235). Different digit COUNTS (1234 vs 12345) are NOT a typo candidate —
 * that's a different, much larger edit, out of scope for "typed the wrong
 * digit" and more likely to be two genuinely different comprobantes.
 */
function isSingleDigitTypo(a: number, b: number): boolean {
  if (a === b) return false;
  const width = Math.max(String(a).length, String(b).length);
  const sa = String(a).padStart(width, '0');
  const sb = String(b).padStart(width, '0');
  let diffs = 0;
  for (let i = 0; i < width; i += 1) {
    if (sa[i] !== sb[i]) diffs += 1;
    if (diffs > 1) return false;
  }
  return diffs === 1;
}

/**
 * Whole-day difference between two 'YYYY-MM-DD' strings, computed via
 * Date.UTC (never the local-timezone-sensitive `new Date(str)` parse) so a
 * server running in any TZ gets the same day count.
 */
function daysBetweenIsoDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / msPerDay);
}

/**
 * RF-04's similarity fallback, tried in order (first hit wins) once the
 * exact composite key has failed to match anywhere: a single-digit typo in
 * `numero` first (tightest signal — same cuit/tipo/punto_venta, exact
 * fecha, importe within tolerance), then fecha+importe proximity alone
 * (loosest — numero/punto_venta free, but fecha and importe both have to be
 * close). `candidates` is expected to already be filtered to the same
 * cuit_emisor + tipo_cbte and not yet consumed by another match this run —
 * a fuzzy match NEVER crosses tipo_cbte (a Factura should never fuzzy-match
 * a Nota de Crédito) or cuit_emisor.
 */
function findSimilarityCandidate(
  sistema: VoucherCanonicalRow,
  candidates: VoucherCanonicalRow[],
  toleranciaArs: number,
  toleranciaDiasFecha: number,
): { row: VoucherCanonicalRow; reason: string } | undefined {
  const sameEmisorYTipo = candidates.filter(
    (c) => c.cuit_emisor === sistema.cuit_emisor && c.tipo_cbte === sistema.tipo_cbte,
  );

  if (sistema.fecha) {
    const typo = sameEmisorYTipo.find(
      (c) =>
        c.punto_venta === sistema.punto_venta &&
        isSingleDigitTypo(sistema.numero, c.numero) &&
        c.fecha === sistema.fecha &&
        Math.abs((sistema.importe_total ?? 0) - (c.importe_total ?? 0)) <= toleranciaArs,
    );
    if (typo) {
      return {
        row: typo,
        reason: `número difiere en 1 dígito: sistema ${sistema.numero} vs ARCA ${typo.numero} (mismo CUIT, tipo, punto de venta, fecha e importe)`,
      };
    }
  }

  if (sistema.fecha) {
    const cercano = sameEmisorYTipo.find(
      (c) =>
        c.fecha !== null &&
        daysBetweenIsoDates(sistema.fecha as string, c.fecha) <= toleranciaDiasFecha &&
        Math.abs((sistema.importe_total ?? 0) - (c.importe_total ?? 0)) <= toleranciaArs,
    );
    if (cercano) {
      const dias = daysBetweenIsoDates(sistema.fecha, cercano.fecha as string);
      return {
        row: cercano,
        reason: `fecha e importe similares (${dias} día(s) de diferencia), número distinto: sistema ${sistema.numero} (PV ${sistema.punto_venta}) vs ARCA ${cercano.numero} (PV ${cercano.punto_venta})`,
      };
    }
  }

  return undefined;
}

const ROW_COLUMNS = `
  id, cuit_emisor, tipo_cbte, punto_venta, numero,
  importe_total::float AS importe_total, iva, fecha::text AS fecha,
  file_source, estado, periodo_alta_id
`;

async function queryRows(pool: Queryable, whereClause: string, params: unknown[]): Promise<VoucherCanonicalRow[]> {
  const { rows } = await pool.query<VoucherCanonicalRow>(
    `SELECT ${ROW_COLUMNS} FROM vouchers_canonical WHERE ${whereClause}`,
    params,
  );
  return rows;
}

/**
 * RF-19: calendar-month difference between the currently viewed período and
 * a pendiente ARCA voucher's own `fecha` (fecha de emisión) — NOT the
 * período it first entered the system through.
 *
 * This replaces an earlier version of this function that measured
 * `periodo_alta_id`'s own mes instead of the voucher's real emission date —
 * confirmed wrong by the client when asked directly (2026-08-22): "La
 * antigüedad se debe calcular siempre en base a la Fecha de Emisión real
 * del comprobante en ARCA... nunca en función de la fecha de carga del
 * archivo al sistema. Si un comprobante fue emitido en ARCA en Noviembre y
 * la empresa lo termina registrando en Febrero, la antigüedad/diferimiento
 * es de 3 meses, sin importar si el archivo de ARCA de Noviembre se subió
 * una o varias veces." `periodo_alta_id` still exists and still matters for
 * the corriente/histórico split above (and for RF-15's upsert semantics in
 * vouchers-canonical-writer.ts) — it's just no longer what antiguedad
 * measures.
 */
async function fetchViewedPeriodoYearMonth(
  pool: Queryable,
  periodoId: string,
): Promise<{ anio: number; mes_num: number } | undefined> {
  const { rows } = await pool.query<{ anio: number; mes_num: number }>(
    `SELECT EXTRACT(YEAR FROM mes)::int AS anio, EXTRACT(MONTH FROM mes)::int AS mes_num
       FROM periodos WHERE id = $1`,
    [periodoId],
  );
  return rows[0];
}

/**
 * `fecha` is read back as 'YYYY-MM-DD' text (see ROW_COLUMNS's
 * `fecha::text`) — sliced directly rather than parsed through `Date`, which
 * would apply local-timezone shifting to what is really just a plain
 * calendar date with no time component.
 */
function yearMonthFromIsoDate(fecha: string): { anio: number; mes_num: number } {
  const [anioStr, mesStr] = fecha.split('-');
  return { anio: Number(anioStr), mes_num: Number(mesStr) };
}

function calendarMonthsBetween(
  viewed: { anio: number; mes_num: number },
  other: { anio: number; mes_num: number },
): number {
  return (viewed.anio - other.anio) * 12 + (viewed.mes_num - other.mes_num);
}

/**
 * RF-04: every `fuzzy_match_confirmations` row for this tenant, split into
 * two lookups — `confirmedArcaBySistemaId` (sistema voucher id -> arca
 * voucher id, for pairings already accepted) and `descartado` (a Set of
 * `sistemaId|arcaId` pairs the contador explicitly rejected, so the same
 * candidate isn't suggested again every time the report is viewed).
 */
async function fetchFuzzyConfirmations(
  pool: Queryable,
  tenantId: string,
): Promise<{ confirmedArcaBySistemaId: Map<string, string>; descartado: Set<string> }> {
  const { rows } = await pool.query<{ sistema_voucher_id: string; arca_voucher_id: string; status: FuzzyConfirmationStatus }>(
    `SELECT sistema_voucher_id, arca_voucher_id, status FROM fuzzy_match_confirmations WHERE tenant_id = $1`,
    [tenantId],
  );
  const confirmedArcaBySistemaId = new Map<string, string>();
  const descartado = new Set<string>();
  for (const r of rows) {
    if (r.status === 'confirmado') {
      confirmedArcaBySistemaId.set(r.sistema_voucher_id, r.arca_voucher_id);
    } else {
      descartado.add(`${r.sistema_voucher_id}|${r.arca_voucher_id}`);
    }
  }
  return { confirmedArcaBySistemaId, descartado };
}

/**
 * Runs the 3-step match for one período, plus RF-04's similarity fallback.
 * `toleranciaArs`/`toleranciaDiasFecha` are passed in (rather than queried
 * here) so this module stays decoupled from the tenants table's own schema —
 * the caller is responsible for reading `tenants.tolerancia_redondeo_ars` /
 * `tenants.tolerancia_dias_fecha` and passing them through.
 * `toleranciaDiasFecha` defaults to 0 (no date-proximity fuzzy matching) so
 * existing call sites that only pass `toleranciaArs` keep their original
 * exact-key-only behavior unchanged.
 */
export async function matchPeriodo(
  pool: Queryable,
  tenantId: string,
  periodoId: string,
  toleranciaArs: number,
  toleranciaDiasFecha = 0,
): Promise<PeriodoMatchSummary> {
  const [sistemaRows, arcaCorriente, arcaHistorico, { confirmedArcaBySistemaId, descartado }] = await Promise.all([
    queryRows(pool, `tenant_id = $1 AND file_source = 'contabilidad' AND periodo_alta_id = $2 AND estado <> 'conciliado'`, [
      tenantId,
      periodoId,
    ]),
    queryRows(pool, `tenant_id = $1 AND file_source = 'arca' AND periodo_alta_id = $2 AND estado <> 'conciliado'`, [
      tenantId,
      periodoId,
    ]),
    queryRows(
      pool,
      `tenant_id = $1 AND file_source = 'arca' AND estado = 'pendiente' AND periodo_alta_id <> $2`,
      [tenantId, periodoId],
    ),
    fetchFuzzyConfirmations(pool, tenantId),
  ]);

  const corrienteMap = new Map(arcaCorriente.map((r) => [buildCompositeKey(r), r]));
  const historicoMap = new Map(arcaHistorico.map((r) => [buildCompositeKey(r), r]));
  const consumedCorriente = new Set<string>();
  const consumedHistorico = new Set<string>();
  // id -> which pool ('corriente'/'historico') + composite key, so a
  // confirmed-pairing lookup (by id, not by composite key — the whole point
  // of a similarity confirmation is that the composite keys DON'T match)
  // can still mark the right row consumed.
  const arcaById = new Map<string, { row: VoucherCanonicalRow; pool: 'corriente' | 'historico' }>();
  for (const r of arcaCorriente) arcaById.set(r.id, { row: r, pool: 'corriente' });
  for (const r of arcaHistorico) arcaById.set(r.id, { row: r, pool: 'historico' });

  const results: PeriodoMatchResult[] = [];
  const unmatchedSistemaKeys: string[] = [];

  for (const sistema of sistemaRows) {
    const key = buildCompositeKey(sistema);

    let arca = corrienteMap.get(key);
    let matchSource: 'corriente' | 'historico' | undefined;
    if (arca) {
      matchSource = 'corriente';
      consumedCorriente.add(key);
    } else {
      arca = historicoMap.get(key);
      if (arca) {
        matchSource = 'historico';
        consumedHistorico.add(key);
      }
    }

    // RF-04: no exact key match — but the contador may have already
    // confirmed a similarity pairing for this exact sistema voucher on a
    // previous review. Treat it exactly like an exact-key match from here.
    let matchedVia: PeriodoMatchResult['matched_via'];
    if (!arca) {
      const confirmedArcaId = confirmedArcaBySistemaId.get(sistema.id);
      if (confirmedArcaId) {
        const found = arcaById.get(confirmedArcaId);
        if (found) {
          arca = found.row;
          matchSource = found.pool;
          matchedVia = 'similitud_confirmada';
          const arcaKey = buildCompositeKey(found.row);
          (found.pool === 'corriente' ? consumedCorriente : consumedHistorico).add(arcaKey);
        }
      }
    }

    if (arca) {
      const delta = Math.abs((sistema.importe_total ?? 0) - (arca.importe_total ?? 0));
      results.push({
        classification: delta <= toleranciaArs ? 'conciliado_ok' : 'con_divergencia',
        composite_key: key,
        sistema,
        arca,
        delta,
        match_source: matchSource,
        matched_via: matchedVia ?? 'clave_exacta',
      });
    } else {
      unmatchedSistemaKeys.push(key);
      // classification filled in below, once RF-17's duplicate check runs
      results.push({ classification: 'no_existe_en_arca', composite_key: key, sistema });
    }
  }

  // RF-17: a single query for every unmatched sistema row's composite key
  // against ever-conciliado ARCA vouchers for this tenant (any período) —
  // avoids an N+1 query per unmatched row.
  if (unmatchedSistemaKeys.length > 0) {
    const conciliadoArca = await queryRows(pool, `tenant_id = $1 AND file_source = 'arca' AND estado = 'conciliado'`, [
      tenantId,
    ]);
    const conciliadoKeys = new Set(conciliadoArca.map((r) => buildCompositeKey(r)));
    for (const result of results) {
      if (result.classification === 'no_existe_en_arca' && conciliadoKeys.has(result.composite_key)) {
        result.classification = 'posible_duplicado_en_sistema';
      }
    }
  }

  // RF-04 similarity fallback: for every sistema row still 'no_existe_en_arca'
  // (i.e. not upgraded to posible_duplicado_en_sistema above), look for a
  // similarity candidate among ARCA rows not yet consumed by an exact/confirmed
  // match this run. A candidate the contador already 'descartado' for this
  // exact sistema voucher is skipped (not re-suggested).
  const unconsumedArca = [
    ...arcaCorriente.filter((r) => !consumedCorriente.has(buildCompositeKey(r))),
    ...arcaHistorico.filter((r) => !consumedHistorico.has(buildCompositeKey(r))),
  ];
  for (const result of results) {
    if (result.classification !== 'no_existe_en_arca' || !result.sistema) continue;
    const candidate = findSimilarityCandidate(result.sistema, unconsumedArca, toleranciaArs, toleranciaDiasFecha);
    if (!candidate) continue;
    if (descartado.has(`${result.sistema.id}|${candidate.row.id}`)) continue;
    result.classification = 'posible_coincidencia';
    result.arca = candidate.row;
    result.similarity_reason = candidate.reason;
  }

  // RF-19: leftover ARCA rows (corriente + histórico) never consumed by a
  // sistema match are pendiente_en_arca, with antiguedad_meses. Rows only
  // referenced by an unconfirmed 'posible_coincidencia' suggestion above
  // are deliberately NOT excluded here — until confirmed, they're still
  // genuinely pendiente (RNF-07: a suggestion is never a conclusion).
  const pendientes = [
    ...arcaCorriente.filter((r) => !consumedCorriente.has(buildCompositeKey(r))),
    ...arcaHistorico.filter((r) => !consumedHistorico.has(buildCompositeKey(r))),
  ];
  const viewedYearMonth = await fetchViewedPeriodoYearMonth(pool, periodoId);
  for (const arca of pendientes) {
    const antiguedadMeses =
      viewedYearMonth && arca.fecha ? calendarMonthsBetween(viewedYearMonth, yearMonthFromIsoDate(arca.fecha)) : undefined;
    results.push({
      classification: 'pendiente_en_arca',
      composite_key: buildCompositeKey(arca),
      arca,
      antiguedad_meses: antiguedadMeses,
    });
  }

  const counts: PeriodoMatchCounts = {
    conciliado_ok: 0,
    con_divergencia: 0,
    posible_duplicado_en_sistema: 0,
    no_existe_en_arca: 0,
    pendiente_en_arca: 0,
    posible_coincidencia: 0,
  };
  for (const r of results) counts[r.classification] += 1;

  return { results, counts };
}
