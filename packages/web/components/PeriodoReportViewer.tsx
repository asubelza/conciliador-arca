'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cerrarPeriodo,
  confirmarCoincidencia,
  createPeriodoMark,
  downloadPeriodoReport,
  getPeriodoReport,
  type Periodo,
  type PeriodoReport,
  type PeriodoReportRow,
} from '@/lib/api';
import { useAuth } from '@/lib/session';

export interface PeriodoReportViewerProps {
  periodoId: string;
  /** Called after a successful cierre, with the now-cerrado período row, so the parent can update its own state. */
  onClosed?: (periodo: Periodo) => void;
}

/**
 * RF-04: 4th section for the client's own answer on how a fuzzy match
 * should surface — "su propia sección... el contador la confirma o la
 * descarta con un click." Kept last: it's the only section that needs an
 * explicit contador decision before it affects anything, so it reads as
 * "action needed" after the three read-mostly sections above it.
 */
const SECTION_TITLES: { key: keyof PeriodoReport['sections']; title: string }[] = [
  { key: 'conciliados_ok', title: 'Conciliados OK' },
  { key: 'discrepancias_y_alertas', title: 'Discrepancias y Alertas' },
  { key: 'pendientes_en_arca', title: 'Pendientes en ARCA' },
  { key: 'posibles_coincidencias', title: 'Posible Coincidencia' },
];

/** RF-09: marks only make sense on a row someone might still act on — conciliados_ok is a closed loop, not a review queue (see periodo-report.ts's attachFeedbackAndReprioritize doc). */
const MARKABLE_SECTIONS = new Set<keyof PeriodoReport['sections']>([
  'discrepancias_y_alertas',
  'pendientes_en_arca',
  'posibles_coincidencias',
]);

const CLASSIFICATION_LABELS: Record<PeriodoReportRow['classification'], string> = {
  conciliado_ok: 'Conciliado OK',
  con_divergencia: 'Con divergencia',
  posible_duplicado_en_sistema: 'Posible duplicado en sistema',
  no_existe_en_arca: 'No existe en ARCA',
  pendiente_en_arca: 'Pendiente en ARCA',
  posible_coincidencia: 'Posible coincidencia',
};

function importeOf(row: PeriodoReportRow): number | null {
  return row.arca?.importe_total ?? row.sistema?.importe_total ?? null;
}

function compositeKeyLabel(row: PeriodoReportRow): string {
  const source = row.arca ?? row.sistema;
  if (!source) return row.composite_key;
  return `${source.cuit_emisor} · Tipo ${source.tipo_cbte} · PV ${source.punto_venta} · Nro ${source.numero}`;
}

/** RF-09: "mostrar la nota anterior... nunca ocultar" — a short, human-readable summary of the prior mark, shown right under the row it belongs to. */
function feedbackLabel(feedback: NonNullable<PeriodoReportRow['feedback_previo']>): string {
  const when = new Date(feedback.created_at).toLocaleDateString('es-AR');
  const what = feedback.classification === 'revisado' ? 'Revisado antes' : 'Explicado antes';
  return feedback.note ? `${what} (${when}): "${feedback.note}"` : `${what} (${when})`;
}

/**
 * T31 (RF-22/RF-23, conciliacion-periodica): the 3-section período report —
 * replaces the per-job 4-sheet report (ReportViewer.tsx, still used as-is
 * for a single upload's own diff, unrelated scope) with the client's
 * Conciliados OK / Discrepancias y Alertas / Pendientes en ARCA structure,
 * scoped to a whole período. Also hosts T30's "Cerrar Conciliación del Mes"
 * button (RF-20) — closing only makes sense once the accountant has seen
 * this report, so it lives right where they're already looking.
 */
export function PeriodoReportViewer({ periodoId, onClosed }: PeriodoReportViewerProps) {
  const { user } = useAuth();
  const [report, setReport] = useState<PeriodoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // RF-04/RF-09: shared error surface + in-flight tracking for the per-row
  // confirmar/descartar and revisado/explicado actions below — one row acts
  // at a time, so a single "which key is busy" string is enough (no need
  // for a per-row state map for this UI's scale).
  const [rowActionError, setRowActionError] = useState<string | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const canAct = user?.role !== 'cliente';

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getPeriodoReport(periodoId);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reporte de período failed');
    }
  }, [periodoId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCoincidencia(row: PeriodoReportRow, accion: 'confirmar' | 'descartar') {
    if (!row.sistema || !row.arca) return;
    const key = `${row.composite_key}:${accion}`;
    setRowActionError(null);
    setPendingActionKey(key);
    try {
      await confirmarCoincidencia(periodoId, row.sistema.id, row.arca.id, accion);
      await load();
    } catch (err) {
      setRowActionError(err instanceof Error ? err.message : 'Coincidencia failed');
    } finally {
      setPendingActionKey(null);
    }
  }

  /**
   * RF-09: 'explicado' prompts for a note (RF-11's own contract — a mark
   * can carry an explanatory note); 'revisado' doesn't need one. A
   * cancelled prompt (returns null) aborts without calling the API.
   */
  async function handleMark(row: PeriodoReportRow, classification: 'revisado' | 'explicado') {
    let note: string | undefined;
    if (classification === 'explicado') {
      if (typeof window === 'undefined') return;
      const entered = window.prompt('Nota para este comprobante (opcional):');
      if (entered === null) return;
      note = entered.trim() === '' ? undefined : entered.trim();
    }
    const key = `${row.composite_key}:${classification}`;
    setRowActionError(null);
    setPendingActionKey(key);
    try {
      await createPeriodoMark(periodoId, row.composite_key, classification, note);
      await load();
    } catch (err) {
      setRowActionError(err instanceof Error ? err.message : 'Mark failed');
    } finally {
      setPendingActionKey(null);
    }
  }

  async function handleDownload(format: 'csv' | 'xlsx') {
    if (!report) return;
    setDownloadError(null);
    try {
      await downloadPeriodoReport(periodoId, report.periodo.mes, format);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  async function handleCerrar() {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Cerrar la Conciliación del Mes es una acción definitiva: los comprobantes conciliados quedan congelados y no se puede deshacer. ¿Confirmás el cierre?',
      );
      if (!confirmed) return;
    }
    setCloseError(null);
    setClosing(true);
    try {
      const result = await cerrarPeriodo(periodoId);
      onClosed?.(result.periodo);
      await load();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Cierre failed');
    } finally {
      setClosing(false);
    }
  }

  if (error) {
    return (
      <p role="alert" className="text-red-600 text-sm">
        {error}
      </p>
    );
  }

  if (!report) {
    return <p className="text-sm text-gray-600">Cargando reporte…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            Reporte de {report.periodo.mes} — {report.periodo.estado}
          </h2>
          <p className="text-xs text-gray-600">
            {report.live ? 'Vista en vivo (el período sigue abierto).' : 'Snapshot congelado al momento del cierre.'}
          </p>
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={() => handleDownload('csv')} className="text-blue-600 underline text-sm">
              Descargar CSV
            </button>
            <button type="button" onClick={() => handleDownload('xlsx')} className="text-blue-600 underline text-sm">
              Descargar Excel
            </button>
          </div>
        </div>
        {/* T39 (Fase 3): cliente is read-only (RF-14) — closing a período is an
            admin/colaborador action server-side (assertRole in periodos.controller.ts),
            so a cliente never sees the button that would only 403 anyway. */}
        {report.periodo.estado === 'abierto' && user?.role !== 'cliente' && (
          <button
            type="button"
            onClick={handleCerrar}
            disabled={closing}
            className="bg-red-600 text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {closing ? 'Cerrando…' : 'Cerrar Conciliación del Mes'}
          </button>
        )}
      </div>

      {downloadError && (
        <p role="alert" className="text-red-600 text-sm">
          {downloadError}
        </p>
      )}

      {closeError && (
        <p role="alert" className="text-red-600 text-sm">
          {closeError}
        </p>
      )}

      {rowActionError && (
        <p role="alert" className="text-red-600 text-sm">
          {rowActionError}
        </p>
      )}

      {SECTION_TITLES.map(({ key, title }) => {
        const rows = report.sections[key];
        const showDivergencia = key === 'discrepancias_y_alertas';
        const showAntiguedad = key === 'pendientes_en_arca';
        const showMotivo = key === 'posibles_coincidencias';
        const markable = canAct && MARKABLE_SECTIONS.has(key);
        return (
          <div key={key} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              {title} ({rows.length})
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-gray-600">Sin filas.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-3">Comprobante</th>
                    <th className="py-1 pr-3">Clasificación</th>
                    <th className="py-1 pr-3">Importe</th>
                    {showDivergencia && <th className="py-1 pr-3">Divergencia</th>}
                    {showAntiguedad && <th className="py-1 pr-3">Antigüedad (meses)</th>}
                    {showMotivo && <th className="py-1 pr-3">Motivo</th>}
                    {markable && <th className="py-1 pr-3">Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rowKey = row.composite_key + row.classification;
                    return (
                      <tr key={rowKey} className="border-b align-top">
                        <td className="py-1 pr-3">
                          {compositeKeyLabel(row)}
                          {row.feedback_previo && (
                            <div className="text-xs text-gray-500 italic mt-0.5">{feedbackLabel(row.feedback_previo)}</div>
                          )}
                        </td>
                        <td className="py-1 pr-3">{CLASSIFICATION_LABELS[row.classification]}</td>
                        <td className="py-1 pr-3">{importeOf(row) ?? '—'}</td>
                        {showDivergencia && (
                          <td className="py-1 pr-3">
                            {row.divergencia_ars !== null ? (
                              <span className="text-amber-700">${row.divergencia_ars.toFixed(2)}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        {showAntiguedad && <td className="py-1 pr-3">{row.antiguedad_meses ?? '—'}</td>}
                        {showMotivo && <td className="py-1 pr-3 text-gray-700">{row.similarity_reason ?? '—'}</td>}
                        {markable && (
                          <td className="py-1 pr-3">
                            <div className="flex flex-col gap-1 items-start">
                              {key === 'posibles_coincidencias' && row.sistema && row.arca && (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleCoincidencia(row, 'confirmar')}
                                    disabled={pendingActionKey === `${row.composite_key}:confirmar`}
                                    className="text-green-700 underline text-xs disabled:opacity-50"
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCoincidencia(row, 'descartar')}
                                    disabled={pendingActionKey === `${row.composite_key}:descartar`}
                                    className="text-red-700 underline text-xs disabled:opacity-50"
                                  >
                                    Descartar
                                  </button>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleMark(row, 'revisado')}
                                  disabled={pendingActionKey === `${row.composite_key}:revisado`}
                                  className="text-blue-600 underline text-xs disabled:opacity-50"
                                >
                                  Revisado
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMark(row, 'explicado')}
                                  disabled={pendingActionKey === `${row.composite_key}:explicado`}
                                  className="text-blue-600 underline text-xs disabled:opacity-50"
                                >
                                  Explicado
                                </button>
                              </div>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
