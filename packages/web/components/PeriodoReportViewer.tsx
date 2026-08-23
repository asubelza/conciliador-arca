'use client';

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
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
import { CoincidenciaModal } from './CoincidenciaModal';
import { CheckIcon, SpinnerIcon, XIcon } from './icons';

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

/**
 * Acento de color por sección — puramente visual, no cambia ningún texto
 * renderizado. `posibles_coincidencias` usa violeta a propósito: coincide
 * con el acento FF6D28D9 que periodo-report-exporter.ts ya usa para esa
 * misma sección en el XLSX, para que pantalla y export se vean consistentes.
 */
const SECTION_ACCENT: Record<keyof PeriodoReport['sections'], { dot: string; header: string }> = {
  conciliados_ok: { dot: 'bg-emerald-500', header: 'text-emerald-700 dark:text-emerald-400' },
  discrepancias_y_alertas: { dot: 'bg-amber-500', header: 'text-amber-700 dark:text-amber-400' },
  pendientes_en_arca: { dot: 'bg-slate-400', header: 'text-slate-700 dark:text-slate-300' },
  posibles_coincidencias: { dot: 'bg-violet-500', header: 'text-violet-700 dark:text-violet-400' },
};

/** Color de la etiqueta de clasificación — solo estético. */
function classificationBadgeClass(classification: PeriodoReportRow['classification']): string {
  if (classification === 'conciliado_ok') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400';
  }
  if (classification === 'posible_coincidencia') {
    return 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400';
  }
  if (classification === 'con_divergencia' || classification === 'posible_duplicado_en_sistema') {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

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
  // T39 (pedido del cliente, 2026-08-23): la fila de "Posible Coincidencia"
  // que está abierta en el modal de comparación campo por campo, o null si
  // ninguna. Independiente de pendingActionKey — el modal se cierra apenas
  // se dispara la acción (igual que los botones rápidos inline no esperan
  // a que termine el fetch para que la UI se sienta responsiva).
  const [comparingRow, setComparingRow] = useState<PeriodoReportRow | null>(null);
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
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!report) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <SpinnerIcon size={16} />
        Cargando reporte…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Reporte de {report.periodo.mes} —{' '}
            <span
              className={
                report.periodo.estado === 'abierto'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }
            >
              {report.periodo.estado}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {report.live ? 'Vista en vivo (el período sigue abierto).' : 'Snapshot congelado al momento del cierre.'}
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => handleDownload('csv')}
              className="focus-ring rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Descargar CSV
            </button>
            <button
              type="button"
              onClick={() => handleDownload('xlsx')}
              className="focus-ring rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
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
            className="focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {closing && <SpinnerIcon size={16} />}
            {closing ? 'Cerrando…' : 'Cerrar Conciliación del Mes'}
          </button>
        )}
      </div>

      {downloadError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {downloadError}
        </p>
      )}

      {closeError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {closeError}
        </p>
      )}

      {rowActionError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {rowActionError}
        </p>
      )}

      {SECTION_TITLES.map(({ key, title }) => {
        const rows = report.sections[key];
        const showDivergencia = key === 'discrepancias_y_alertas';
        const showAntiguedad = key === 'pendientes_en_arca';
        const showMotivo = key === 'posibles_coincidencias';
        const markable = canAct && MARKABLE_SECTIONS.has(key);
        const accent = SECTION_ACCENT[key];
        return (
          <div
            key={key}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className={`flex items-center gap-2 text-sm font-semibold ${accent.header}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${accent.dot}`} />
              {title} ({rows.length})
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Sin filas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="px-3 py-2 font-medium">Comprobante</th>
                      <th className="px-3 py-2 font-medium">Clasificación</th>
                      <th className="px-3 py-2 font-medium">Importe</th>
                      {showDivergencia && <th className="px-3 py-2 font-medium">Divergencia</th>}
                      {showAntiguedad && <th className="px-3 py-2 font-medium">Antigüedad (meses)</th>}
                      {showMotivo && <th className="px-3 py-2 font-medium">Motivo</th>}
                      {markable && <th className="px-3 py-2 font-medium">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rowKey = row.composite_key + row.classification;
                      // T39: sólo las filas de "Posible Coincidencia" con
                      // ambos lados presentes son clickeables — son las
                      // únicas que tienen algo que comparar campo a campo.
                      const isCoincidenciaRow = key === 'posibles_coincidencias' && !!row.sistema && !!row.arca;
                      return (
                        <tr
                          key={rowKey}
                          className={`border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60 ${
                            isCoincidenciaRow ? 'cursor-pointer hover:bg-violet-50/60 dark:hover:bg-violet-950/20' : ''
                          }`}
                          {...(isCoincidenciaRow
                            ? {
                                role: 'button' as const,
                                tabIndex: 0,
                                'aria-label': 'Comparar posible coincidencia',
                                onClick: () => setComparingRow(row),
                                onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setComparingRow(row);
                                  }
                                },
                              }
                            : {})}
                        >
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            {compositeKeyLabel(row)}
                            {row.feedback_previo && (
                              <div className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">
                                {feedbackLabel(row.feedback_previo)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classificationBadgeClass(row.classification)}`}
                            >
                              {CLASSIFICATION_LABELS[row.classification]}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{importeOf(row) ?? '—'}</td>
                          {showDivergencia && (
                            <td className="px-3 py-2">
                              {row.divergencia_ars !== null ? (
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  ${row.divergencia_ars.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          )}
                          {showAntiguedad && (
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.antiguedad_meses ?? '—'}</td>
                          )}
                          {showMotivo && (
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{row.similarity_reason ?? '—'}</td>
                          )}
                          {markable && (
                            <td className="px-3 py-2">
                              <div className="flex flex-col items-start gap-1.5">
                                {key === 'posibles_coincidencias' && row.sistema && row.arca && (
                                  <div className="flex gap-3">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCoincidencia(row, 'confirmar');
                                      }}
                                      disabled={pendingActionKey === `${row.composite_key}:confirmar`}
                                      className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-emerald-600 hover:text-emerald-500 disabled:opacity-50 dark:text-emerald-400"
                                    >
                                      {pendingActionKey === `${row.composite_key}:confirmar` ? (
                                        <SpinnerIcon size={12} />
                                      ) : (
                                        <CheckIcon size={12} />
                                      )}
                                      Confirmar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCoincidencia(row, 'descartar');
                                      }}
                                      disabled={pendingActionKey === `${row.composite_key}:descartar`}
                                      className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50 dark:text-red-400"
                                    >
                                      {pendingActionKey === `${row.composite_key}:descartar` ? (
                                        <SpinnerIcon size={12} />
                                      ) : (
                                        <XIcon size={12} />
                                      )}
                                      Descartar
                                    </button>
                                  </div>
                                )}
                                <div className="flex gap-3">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMark(row, 'revisado');
                                    }}
                                    disabled={pendingActionKey === `${row.composite_key}:revisado`}
                                    className="focus-ring rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50 dark:text-indigo-400"
                                  >
                                    Revisado
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMark(row, 'explicado');
                                    }}
                                    disabled={pendingActionKey === `${row.composite_key}:explicado`}
                                    className="focus-ring rounded text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50 dark:text-indigo-400"
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
              </div>
            )}
          </div>
        );
      })}

      {comparingRow && (
        <CoincidenciaModal
          row={comparingRow}
          onClose={() => setComparingRow(null)}
          onConfirmar={
            canAct
              ? () => {
                  handleCoincidencia(comparingRow, 'confirmar');
                  setComparingRow(null);
                }
              : undefined
          }
          onDescartar={
            canAct
              ? () => {
                  handleCoincidencia(comparingRow, 'descartar');
                  setComparingRow(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
