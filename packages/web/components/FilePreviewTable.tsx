'use client';

import type { PreviewResult, PreviewSide } from '@/lib/api';
import { CheckIcon, WarningIcon } from './icons';

export interface FilePreviewTableProps {
  preview: PreviewResult;
}

/**
 * Previsualización de carga (pedido del cliente, 2026-08-23, feature 1 de
 * 3): tabla de cómo se están leyendo los datos de un archivo, ANTES de
 * conciliar de verdad — UploadForm.tsx la muestra tras
 * POST /api/reconciliations/preview, antes de reenviar los mismos archivos
 * a la carga real. Decisión confirmada con el usuario: se muestran TODAS
 * las filas (no una muestra), con scroll — de ahí el contenedor con
 * max-height + overflow-y-auto en vez de paginar o truncar.
 */
function SideTable({ title, side }: { title: string; side: PreviewSide }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            {side.ok} OK
          </span>
          {side.errors > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {side.errors} con error
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {side.total} filas
          </span>
        </div>
      </div>

      {side.rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Sin filas.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="sticky top-0 bg-white dark:bg-slate-900">
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">CUIT emisor</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Pto. Vta.</th>
                <th className="px-3 py-2 font-medium">Número</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Importe</th>
              </tr>
            </thead>
            <tbody>
              {side.rows.map((row, index) => (
                <tr
                  key={index}
                  className={`border-b border-slate-100 last:border-0 dark:border-slate-800/60 ${
                    row.ok ? '' : 'bg-red-50/60 dark:bg-red-950/20'
                  }`}
                >
                  <td className="px-3 py-2">
                    {row.ok ? (
                      <CheckIcon size={14} className="text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <WarningIcon size={14} className="text-red-600 dark:text-red-400" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{row.cuit_emisor}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.tipo_cbte}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.punto_venta}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.numero}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.fecha_emision}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.importe_total_ars}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FilePreviewTable({ preview }: FilePreviewTableProps) {
  return (
    <div className="flex flex-col gap-5">
      <SideTable title="Archivo ARCA" side={preview.arca} />
      <SideTable title="Archivo Contabilidad" side={preview.contabilidad} />
    </div>
  );
}
