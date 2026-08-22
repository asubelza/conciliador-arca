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
 *
 * RF-04 follow-up: a 4th section, `posibles_coincidencias`, for
 * 'posible_coincidencia' rows (see periodo-matching-engine.ts's module doc)
 * — the client's own answer, when asked how these should surface, was "su
 * propia sección... el contador la confirma o la descarta con un click."
 *
 * RF-09 follow-up: every row across every section now carries
 * `feedback_previo` — the most recent `feedback_loop` mark (if any) for
 * that row's composite_key, from ANY previous período. RNF-07 rules out
 * silently hiding anything the contador hasn't reviewed, so a row with
 * prior feedback still appears — `sortByPriority` below just moves it
 * later within its section, past rows nobody has looked at yet.
 */
import type { Pool } from 'pg';
import {
  matchPeriodo,
  PeriodoClassification,
  PeriodoMatchResult,
  VoucherCanonicalRow,
} from '../reconciliations/periodo-matching-engine';
import { readFeedbackLoop } from '../reconciliations/feedback-writer';

export type PeriodoReportFailure = { code: 'NOT_FOUND'; status: 404; error: string };

export interface PeriodoReportFeedback {
  classification: string;
  note: string | null;
  created_at: string;
}

export interface PeriodoReportRow {
  classification: PeriodoClassification;
  composite_key: string;
  sistema: VoucherCanonicalRow | null;
  arca: VoucherCanonicalRow | null;
  /** Only set for a con_divergencia row — the |sistema - arca| amount gap (RF-23). */
  divergencia_ars: number | null;
  /** Only set for pendiente_en_arca rows (RF-19). */
  antiguedad_meses: number | null;
  /** RF-04: only set for 'posible_coincidencia' — why these two rows were suggested as a match. */
  similarity_reason: string | null;
  /** RF-09: the most recent prior feedback_loop mark for this composite_key, from any período, or null if the contador never marked it before. */
  feedback_previo: PeriodoReportFeedback | null;
}

export interface PeriodoReportSections {
  conciliados_ok: PeriodoReportRow[];
  discrepancias_y_alertas: PeriodoReportRow[];
  pendientes_en_arca: PeriodoReportRow[];
  /** RF-04: similarity candidates awaiting the contador's confirmar/descartar decision. */
  posibles_coincidencias: PeriodoReportRow[];
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
  similarity_reason: string | null;
}

function emptySections(): PeriodoReportSections {
  return { conciliados_ok: [], discrepancias_y_alertas: [], pendientes_en_arca: [], posibles_coincidencias: [] };
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
      return;
    case 'posible_coincidencia':
      sections.posibles_coincidencias.push(row);
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
    similarity_reason: r.similarity_reason ?? null,
    feedback_previo: null, // attached in a bulk pass below (attachFeedback)
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
    similarity_reason: r.similarity_reason,
    feedback_previo: null,
  };
}

/**
 * RF-09: bulk-attaches each row's most recent prior feedback_loop mark (by
 * composite_key), then reorders `discrepancias_y_alertas`,
 * `pendientes_en_arca`, and `posibles_coincidencias` so rows WITHOUT prior
 * feedback come first — never hides anything (RNF-07), just deprioritizes
 * what the contador already looked at once. `conciliados_ok` is left in
 * its original order: it isn't an actionable review queue, so priority
 * doesn't apply there, though feedback_previo is still attached for
 * context if the contador looks.
 */
async function attachFeedbackAndReprioritize(pool: Pool, tenantId: string, sections: PeriodoReportSections): Promise<void> {
  const marks = await readFeedbackLoop(pool, tenantId);
  // `readFeedbackLoop` orders created_at DESC — the first mark seen per
  // composite_key in that order is the most recent one.
  const latestByKey = new Map<string, PeriodoReportFeedback>();
  for (const m of marks) {
    if (!latestByKey.has(m.composite_key)) {
      latestByKey.set(m.composite_key, { classification: m.classification, note: m.note, created_at: m.created_at });
    }
  }

  const allRows = [
    ...sections.conciliados_ok,
    ...sections.discrepancias_y_alertas,
    ...sections.pendientes_en_arca,
    ...sections.posibles_coincidencias,
  ];
  for (const row of allRows) {
    row.feedback_previo = latestByKey.get(row.composite_key) ?? null;
  }

  const hasFeedback = (r: PeriodoReportRow): number => (r.feedback_previo ? 1 : 0);

  sections.discrepancias_y_alertas.sort(
    (a, b) => hasFeedback(a) - hasFeedback(b) || Math.abs(b.divergencia_ars ?? 0) - Math.abs(a.divergencia_ars ?? 0),
  );
  sections.pendientes_en_arca.sort(
    (a, b) => hasFeedback(a) - hasFeedback(b) || (b.antiguedad_meses ?? 0) - (a.antiguedad_meses ?? 0),
  );
  sections.posibles_coincidencias.sort((a, b) => hasFeedback(a) - hasFeedback(b));
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
      `SELECT classification, composite_key, sistema_row, arca_row, delta, antiguedad_meses, similarity_reason
         FROM periodo_resultados WHERE periodo_id = $1`,
      [periodoId],
    );
    for (const r of rows) pushInto(sections, fromFrozenRow(r), true);
    await attachFeedbackAndReprioritize(pool, periodo.tenant_id, sections);
    return { periodo, live: false, sections };
  }

  const { rows: tenantRows } = await pool.query<{ tolerancia_redondeo_ars: string; tolerancia_dias_fecha: number }>(
    'SELECT tolerancia_redondeo_ars, tolerancia_dias_fecha FROM tenants WHERE id = $1',
    [periodo.tenant_id],
  );
  const toleranciaArs = Number(tenantRows[0]?.tolerancia_redondeo_ars ?? 0.99);
  const toleranciaDiasFecha = tenantRows[0]?.tolerancia_dias_fecha ?? 5;
  const { results } = await matchPeriodo(pool, periodo.tenant_id, periodoId, toleranciaArs, toleranciaDiasFecha);
  for (const r of results) pushInto(sections, fromLiveResult(r), false);
  await attachFeedbackAndReprioritize(pool, periodo.tenant_id, sections);

  return { periodo, live: true, sections };
}
