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
  | 'pendiente_en_arca';

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

/** RF-19: calendar-month difference between a período and the currently viewed período, via periodos.mes (both normalized to the 1st of their month). */
async function fetchAntiguedadLookup(
  pool: Queryable,
  periodoId: string,
  otherPeriodoIds: string[],
): Promise<Map<string, number>> {
  const ids = Array.from(new Set([periodoId, ...otherPeriodoIds]));
  if (ids.length === 0) return new Map();

  const { rows } = await pool.query<{ id: string; anio: number; mes_num: number }>(
    `SELECT id, EXTRACT(YEAR FROM mes)::int AS anio, EXTRACT(MONTH FROM mes)::int AS mes_num
       FROM periodos WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const viewed = byId.get(periodoId);
  if (!viewed) return new Map();

  const antiguedad = new Map<string, number>();
  for (const altaId of otherPeriodoIds) {
    const alta = byId.get(altaId);
    if (!alta) continue;
    antiguedad.set(altaId, (viewed.anio - alta.anio) * 12 + (viewed.mes_num - alta.mes_num));
  }
  return antiguedad;
}

/**
 * Runs the 3-step match for one período. `toleranciaArs` is passed in
 * (rather than queried here) so this module stays decoupled from the
 * tenants table's own schema — the caller (a future cierre/report
 * endpoint, T27/T29) is responsible for reading
 * `tenants.tolerancia_redondeo_ars` and passing it through.
 */
export async function matchPeriodo(
  pool: Queryable,
  tenantId: string,
  periodoId: string,
  toleranciaArs: number,
): Promise<PeriodoMatchSummary> {
  const [sistemaRows, arcaCorriente, arcaHistorico] = await Promise.all([
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
  ]);

  const corrienteMap = new Map(arcaCorriente.map((r) => [buildCompositeKey(r), r]));
  const historicoMap = new Map(arcaHistorico.map((r) => [buildCompositeKey(r), r]));
  const consumedCorriente = new Set<string>();
  const consumedHistorico = new Set<string>();

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

    if (arca) {
      const delta = Math.abs((sistema.importe_total ?? 0) - (arca.importe_total ?? 0));
      results.push({
        classification: delta <= toleranciaArs ? 'conciliado_ok' : 'con_divergencia',
        composite_key: key,
        sistema,
        arca,
        delta,
        match_source: matchSource,
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

  // RF-19: leftover ARCA rows (corriente + histórico) never consumed by a
  // sistema match are pendiente_en_arca, with antiguedad_meses.
  const pendientes = [
    ...arcaCorriente.filter((r) => !consumedCorriente.has(buildCompositeKey(r))),
    ...arcaHistorico.filter((r) => !consumedHistorico.has(buildCompositeKey(r))),
  ];
  const antiguedadLookup = await fetchAntiguedadLookup(
    pool,
    periodoId,
    pendientes.map((r) => r.periodo_alta_id),
  );
  for (const arca of pendientes) {
    results.push({
      classification: 'pendiente_en_arca',
      composite_key: buildCompositeKey(arca),
      arca,
      antiguedad_meses: antiguedadLookup.get(arca.periodo_alta_id),
    });
  }

  const counts: PeriodoMatchCounts = {
    conciliado_ok: 0,
    con_divergencia: 0,
    posible_duplicado_en_sistema: 0,
    no_existe_en_arca: 0,
    pendiente_en_arca: 0,
  };
  for (const r of results) counts[r.classification] += 1;

  return { results, counts };
}
