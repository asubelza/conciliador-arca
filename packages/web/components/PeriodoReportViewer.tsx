'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cerrarPeriodo,
  getPeriodoReport,
  periodoReportDownloadUrl,
  type Periodo,
  type PeriodoReport,
  type PeriodoReportRow,
} from '@/lib/api';

export interface PeriodoReportViewerProps {
  periodoId: string;
  /** Called after a successful cierre, with the now-cerrado período row, so the parent can update its own state. */
  onClosed?: (periodo: Periodo) => void;
}

const SECTION_TITLES: { key: keyof PeriodoReport['sections']; title: string }[] = [
  { key: 'conciliados_ok', title: 'Conciliados OK' },
  { key: 'discrepancias_y_alertas', title: 'Discrepancias y Alertas' },
  { key: 'pendientes_en_arca', title: 'Pendientes en ARCA' },
];

const CLASSIFICATION_LABELS: Record<PeriodoReportRow['classification'], string> = {
  conciliado_ok: 'Conciliado OK',
  con_divergencia: 'Con divergencia',
  posible_duplicado_en_sistema: 'Posible duplicado en sistema',
  no_existe_en_arca: 'No existe en ARCA',
  pendiente_en_arca: 'Pendiente en ARCA',
};

function importeOf(row: PeriodoReportRow): number | null {
  return row.arca?.importe_total ?? row.sistema?.importe_total ?? null;
}

function compositeKeyLabel(row: PeriodoReportRow): string {
  const source = row.arca ?? row.sistema;
  if (!source) return row.composite_key;
  return `${source.cuit_emisor} · Tipo ${source.tipo_cbte} · PV ${source.punto_venta} · Nro ${source.numero}`;
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
  const [report, setReport] = useState<PeriodoReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

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
            <a href={periodoReportDownloadUrl(periodoId, 'csv')} className="text-blue-600 underline text-sm">
              Descargar CSV
            </a>
            <a href={periodoReportDownloadUrl(periodoId, 'xlsx')} className="text-blue-600 underline text-sm">
              Descargar Excel
            </a>
          </div>
        </div>
        {report.periodo.estado === 'abierto' && (
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

      {closeError && (
        <p role="alert" className="text-red-600 text-sm">
          {closeError}
        </p>
      )}

      {SECTION_TITLES.map(({ key, title }) => {
        const rows = report.sections[key];
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
                    {key !== 'pendientes_en_arca' && <th className="py-1 pr-3">Divergencia</th>}
                    {key === 'pendientes_en_arca' && <th className="py-1 pr-3">Antigüedad (meses)</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.composite_key + row.classification} className="border-b">
                      <td className="py-1 pr-3">{compositeKeyLabel(row)}</td>
                      <td className="py-1 pr-3">{CLASSIFICATION_LABELS[row.classification]}</td>
                      <td className="py-1 pr-3">{importeOf(row) ?? '—'}</td>
                      {key !== 'pendientes_en_arca' && (
                        <td className="py-1 pr-3">
                          {row.divergencia_ars !== null ? (
                            <span className="text-amber-700">${row.divergencia_ars.toFixed(2)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {key === 'pendientes_en_arca' && (
                        <td className="py-1 pr-3">{row.antiguedad_meses ?? '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
