'use client';

import type { StatusResponse } from '@/lib/api';
import { CheckIcon, WarningIcon } from './icons';

export interface UploadSummaryProps {
  counts: StatusResponse['counts'];
  onViewDetails: () => void;
  onUploadAnother: () => void;
  showingDetails: boolean;
}

function BigNumber({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-3xl font-bold ${accent}`}>{value}</span>
    </div>
  );
}

/**
 * T38 (pedido del cliente, 2026-08-23, feature 2 de 3): pantalla resumen
 * entre "carga procesada" y el reporte detallado (ReportViewer.tsx, sin
 * cambios). Decisión confirmada: "pantalla resumen nueva + reporte
 * detallado actual" — esta pantalla muestra si hubo match o no y un
 * conteo grande de cada lado; "Ver reporte detallado" revela el reporte
 * existente sin reemplazarlo. Los conteos vienen de job-status.ts's
 * StatusResponse (ya calculados por el worker — ver ese módulo).
 */
export function UploadSummary({ counts, onViewDetails, onUploadAnother, showingDetails }: UploadSummaryProps) {
  const hasMatches = (counts?.matched ?? 0) > 0;
  const hasDiscrepancies = counts
    ? counts['unmatched-arca'] + counts['unmatched-contabilidad'] + counts.duplicates + counts.errors > 0
    : false;

  let headline = 'Carga procesada.';
  if (counts) {
    if (hasMatches && !hasDiscrepancies) headline = 'Carga procesada: todo concilia.';
    else if (hasMatches) headline = 'Carga procesada: hay coincidencias y también diferencias.';
    else headline = 'Carga procesada: no se encontraron coincidencias.';
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-card dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasMatches && !hasDiscrepancies ? (
            <CheckIcon size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <WarningIcon size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{headline}</p>
        </div>
        <button
          type="button"
          onClick={onUploadAnother}
          className="focus-ring rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-indigo-500"
        >
          Subir otro archivo
        </button>
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BigNumber label="ARCA" value={counts.arca_rows} accent="text-slate-800 dark:text-slate-100" />
          <BigNumber label="Contabilidad" value={counts.contabilidad_rows} accent="text-slate-800 dark:text-slate-100" />
          <BigNumber label="Coinciden" value={counts.matched} accent="text-emerald-600 dark:text-emerald-400" />
          <BigNumber label="Sin match (ARCA)" value={counts['unmatched-arca']} accent="text-amber-600 dark:text-amber-400" />
          <BigNumber
            label="Sin match (Contabilidad)"
            value={counts['unmatched-contabilidad']}
            accent="text-amber-600 dark:text-amber-400"
          />
          <BigNumber label="Duplicados" value={counts.duplicates} accent="text-amber-600 dark:text-amber-400" />
          <BigNumber label="Errores" value={counts.errors} accent="text-red-600 dark:text-red-400" />
        </div>
      )}

      {!showingDetails && (
        <button
          type="button"
          onClick={onViewDetails}
          className="focus-ring self-start rounded text-sm font-medium text-indigo-700 hover:text-indigo-600 dark:text-indigo-400"
        >
          Ver reporte detallado
        </button>
      )}
    </div>
  );
}
