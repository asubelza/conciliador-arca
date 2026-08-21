'use client';

import { useCallback, useEffect, useState } from 'react';
import { createMark, getReportRows, reportDownloadUrl, type DiffReportRow, type UserMarkClassification } from '@/lib/api';

export interface ReportViewerProps {
  jobId: string;
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
      <p role="alert" className="text-red-600 text-sm">
        {error}
      </p>
    );
  }

  if (!rows) {
    return <p className="text-sm text-gray-600">Cargando reporte…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <a href={reportDownloadUrl(jobId, 'csv')} className="text-blue-600 underline text-sm">
          Descargar CSV
        </a>
        <a href={reportDownloadUrl(jobId, 'xlsx')} className="text-blue-600 underline text-sm">
          Descargar Excel
        </a>
      </div>

      {markError && (
        <p role="alert" className="text-red-600 text-sm">
          {markError}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">Sin diferencias: todo concilia.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1 pr-3">Clasificación</th>
              <th className="py-1 pr-3">Clave</th>
              <th className="py-1 pr-3">ARCA</th>
              <th className="py-1 pr-3">Contabilidad</th>
              <th className="py-1 pr-3">Delta</th>
              <th className="py-1 pr-3">IVA</th>
              <th className="py-1 pr-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.composite_key} className="border-b">
                <td className="py-1 pr-3">{row.classification}</td>
                <td className="py-1 pr-3">{row.composite_key}</td>
                <td className="py-1 pr-3">{row.arca_importe ?? '—'}</td>
                <td className="py-1 pr-3">{row.contabilidad_importe ?? '—'}</td>
                <td className="py-1 pr-3">{row.delta ?? '—'}</td>
                <td className="py-1 pr-3">{row.iva_amount ?? '—'}</td>
                <td className="py-1 pr-3">
                  {markedKeys[row.composite_key] ? (
                    <span className="text-green-700">{markedKeys[row.composite_key]}</span>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleMark(row.composite_key, 'revisado')}
                        className="underline"
                      >
                        Marcar como revisado
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMark(row.composite_key, 'explicado')}
                        className="underline"
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
      )}
    </div>
  );
}
