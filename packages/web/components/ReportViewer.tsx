'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createMark,
  downloadReconciliationReport,
  getReportRows,
  type DiffReportRow,
  type UserMarkClassification,
} from '@/lib/api';
import { CheckIcon, SpinnerIcon } from './icons';

export interface ReportViewerProps {
  jobId: string;
}

/** Color de la etiqueta de clasificación — solo estético, no cambia el texto renderizado. */
function classificationBadgeClass(classification: string): string {
  if (classification === 'matched') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400';
  }
  if (classification.startsWith('unmatched') || classification.includes('divergencia')) {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

/**
 * T13 (RF-10 + RF-11's client side): fetches the diff report as structured
 * data (`format=json` — see lib/api.ts's `getReportRows` doc), renders it as
 * a table, offers CSV/Excel download links, and lets the user mark each row
 * `revisado`/`explicado` (POST .../marks).
 */
export function ReportViewer({ jobId }: ReportViewerProps) {
  const [rows, setRows] = useState<DiffReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markedKeys, setMarkedKeys] = useState<Record<string, UserMarkClassification>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getReportRows(jobId);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report fetch failed');
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDownload(format: 'csv' | 'xlsx') {
    setDownloadError(null);
    try {
      await downloadReconciliationReport(jobId, format);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  async function handleMark(compositeKey: string, classification: UserMarkClassification) {
    setMarkError(null);
    try {
      let note: string | undefined;
      if (classification === 'explicado' && typeof window !== 'undefined') {
        note = window.prompt('Nota (opcional):') ?? undefined;
      }
      await createMark(jobId, { composite_key: compositeKey, classification, note });
      setMarkedKeys((prev) => ({ ...prev, [compositeKey]: classification }));
    } catch (err) {
      setMarkError(err instanceof Error ? err.message : 'Mark failed');
    }
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!rows) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <SpinnerIcon size={16} />
        Cargando reporte…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
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

      {downloadError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {downloadError}
        </p>
      )}

      {markError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {markError}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Sin diferencias: todo concilia.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">Clasificación</th>
                <th className="px-3 py-2 font-medium">Clave</th>
                <th className="px-3 py-2 font-medium">ARCA</th>
                <th className="px-3 py-2 font-medium">Contabilidad</th>
                <th className="px-3 py-2 font-medium">Delta</th>
                <th className="px-3 py-2 font-medium">IVA</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.composite_key}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                >
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classificationBadgeClass(row.classification)}`}
                    >
                      {row.classification}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{row.composite_key}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.arca_importe ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.contabilidad_importe ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.delta ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.iva_amount ?? '—'}</td>
                  <td className="px-3 py-2">
                    {markedKeys[row.composite_key] ? (
                      <span className="flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckIcon size={14} />
                        {markedKeys[row.composite_key]}
                      </span>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => handleMark(row.composite_key, 'revisado')}
                          className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                        >
                          Marcar como revisado
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMark(row.composite_key, 'explicado')}
                          className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                        >
                          Marcar como explicado
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
