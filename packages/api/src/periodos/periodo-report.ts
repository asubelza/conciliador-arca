/**
 * periodo-report.ts — T29 (RF-22/RF-23,
 * openspec/specs/conciliacion-periodica/reconciliation-reporting-periodica.spec.md):
 * the 3-section período report (Conciliados OK / Discrepancias y Alertas /
 * Pendientes en ARCA), live for an `abierto` período or frozen for a
 * `cerrado` one.
 *
 * Section assignment differs slightly between the two states, per RF-23:
 *
 *   abierto  — conciliado_ok            -> Conciliados OK
 *              con_divergencia          -> Discrepancias y Alertas (still
 *                                           reviewable, nothing conciliado yet)
 *              no_existe_en_arca,
 *              posible_duplicado_en_sistema -> Discrepancias y Alertas
 *              pendiente_en_arca        -> Pendientes en ARCA
 *
 *   cerrado  — conciliado_ok, con_divergencia -> Conciliados OK (RF-20 already
 *                                                 conciliated both at close
 *                                                 time; a closed con_divergencia
 *                                                 row keeps its `divergencia_ars`
 *                                                 so the UI can still flag it —
 *                                                 RF-23's "distinguishable from
 *                                                 a zero-difference exact match")
 *              no_existe_en_arca,
 *              posible_duplicado_en_sistema -> Discrepancias y Alertas
 *              pendiente_en_arca        -> Pendientes en ARCA (frozen leftovers)
 *
 * json is the only format implemented here (T29's scope). RF-22's own
 * scenarios only exercise `format=json`, and the spec's own "Open Questions"
 * section leaves CSV/XLSX for this período-level report unconfirmed with the
 * client — flagged in openspec/progress/PR-6.md rather than guessed at,
 * same judgment-call posture as PR-5's two documented decisions. The
 * existing per-job CSV/XLSX export (T11/T13, report-generator.ts) is
 * untouched.
 */
import type { Pool } from 'pg';
import {
  matchPeriodo,
  PeriodoClassification,
  PeriodoMatchResult,
  VoucherCanonicalRow,
} from '../reconciliations/periodo-matching-engine';

export type PeriodoReportFailure = { code: 'NOT_FOUND'; status: 404; error: string };

export interface PeriodoReportRow {
  classification: PeriodoClassification;
  composite_key: string;
  sistema: VoucherCanonicalRow | null;
  arca: VoucherCanonicalRow | null;
  /** Only set for a con_divergencia row — the |sistema - arca| amount gap (RF-23). */
  divergencia_ars: number | null;
  /** Only set for pendiente_en_arca rows (RF-19). */
  antiguedad_meses: number | null;
}

export interface PeriodoReportSections {
  conciliados_ok: PeriodoReportRow[];
  discrepancias_y_alertas: PeriodoReportRow[];
  pendientes_en_arca: PeriodoReportRow[];
}

export interface PeriodoReportResult {
  periodo: {
    id: string;
    tenant_id: string;
    mes: string;
    estado: 'abierto' | 'cerrado';
    tolerancia_ars: string | null;
    cerrado_at: string | null;
    cerrado_por: string | null;
  };
  live: boolean;
  sections: PeriodoReportSections;
}

interface PeriodoRowForReport {
  id: string;
  tenant_id: string;
  mes: string;
  estado: 'abierto' | 'cerrado';
  tolerancia_ars: string | null;
  cerrado_at: string | null;
  cerrado_por: string | null;
}

interface PeriodoResultadoRow {
  classification: PeriodoClassification;
  composite_key: string;
  sistema_row: VoucherCanonicalRow | null;
  arca_row: VoucherCanonicalRow | null;
  delta: string | null;
  antiguedad_meses: number | null;
}

function emptySections(): PeriodoReportSections {
  return { conciliados_ok: [], discrepancias_y_alertas: [], pendientes_en_arca: [] };
}

function pushInto(sections: PeriodoReportSections, row: PeriodoReportRow, closed: boolean): void {
  switch (row.classification) {
    case 'conciliado_ok':
      sections.conciliados_ok.push(row);
      return;
    case 'con_divergencia':
      // Open: still under review, goes to Discrepancias. Closed: RF-20
      // already conciliated it — goes to Conciliados OK, still tagged.
      (closed ? sections.conciliados_ok : sections.discrepancias_y_alertas).push(row);
      return;
    case 'no_existe_en_arca':
    case 'posible_duplicado_en_sistema':
      sections.discrepancias_y_alertas.push(row);
      return;
    case 'pendiente_en_arca':
      sections.pendientes_en_arca.push(row);
  }
}

function fromLiveResult(r: PeriodoMatchResult): PeriodoReportRow {
  return {
    classification: r.classification,
    composite_key: r.composite_key,
    sistema: r.sistema ?? null,
    arca: r.arca ?? null,
    divergencia_ars: r.classification === 'con_divergencia' ? r.delta ?? null : null,
    antiguedad_meses: r.antiguedad_meses ?? null,
  };
}

function fromFrozenRow(r: PeriodoResultadoRow): PeriodoReportRow {
  return {
    classification: r.classification,
    composite_key: r.composite_key,
    sistema: r.sistema_row,
    arca: r.arca_row,
    divergencia_ars: r.classification === 'con_divergencia' ? (r.delta !== null ? Number(r.delta) : null) : null,
    antiguedad_meses: r.antiguedad_meses,
  };
}

/**
 * RF-22/RF-23: builds the 3-section report for a período — live
 * (`matchPeriodo`, recomputed on every call) while `abierto`, or the frozen
 * `periodo_resultados` snapshot once `cerrado`. Never throws for a missing
 * período — returns a typed failure, same style as periodo-cierre.ts.
 */
export async function getPeriodoReport(
  pool: Pool,
  periodoId: string,
): Promise<PeriodoReportResult | PeriodoReportFailure> {
  const { rows: periodoRows } = await pool.query<PeriodoRowForReport>(
    `SELECT id, tenant_id, mes::text AS mes, estado, tolerancia_ars, cerrado_at::text AS cerrado_at, cerrado_por
       FROM periodos WHERE id = $1`,
    [periodoId],
  );
  if (periodoRows.length === 0) {
    return { code: 'NOT_FOUND', status: 404, error: 'período not found' };
  }
  const periodo = periodoRows[0];
  const sections = emptySections();

  if (periodo.estado === 'cerrado') {
    const { rows } = await pool.query<PeriodoResultadoRow>(
      `SELECT classification, composite_key, sistema_row, arca_row, delta, antiguedad_meses
         FROM periodo_resultados WHERE periodo_id = $1`,
      [periodoId],
    );
    for (const r of rows) pushInto(sections, fromFrozenRow(r), true);
    return { periodo, live: false, sections };
  }

  const { rows: tenantRows } = await pool.query<{ tolerancia_redondeo_ars: string }>(
    'SELECT tolerancia_redondeo_ars FROM tenants WHERE id = $1',
    [periodo.tenant_id],
  );
  const toleranciaArs = Number(tenantRows[0]?.tolerancia_redondeo_ars ?? 0.99);
  const { results } = await matchPeriodo(pool, periodo.tenant_id, periodoId, toleranciaArs);
  for (const r of results) pushInto(sections, fromLiveResult(r), false);

  return { periodo, live: true, sections };
}
