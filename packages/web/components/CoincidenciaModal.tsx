'use client';

import type { PeriodoReportRow, PeriodoVoucherRow } from '@/lib/api';
import { CheckIcon, SpinnerIcon, XIcon } from './icons';

export interface CoincidenciaModalProps {
  row: PeriodoReportRow;
  onClose: () => void;
  /** Omitted (undefined) for a read-only viewer (cliente, RF-14) — the modal then shows the comparison without any action. */
  onConfirmar?: () => void;
  onDescartar?: () => void;
  confirmando?: boolean;
  descartando?: boolean;
}

const FIELDS: { key: keyof PeriodoVoucherRow; label: string }[] = [
  { key: 'cuit_emisor', label: 'CUIT emisor' },
  { key: 'tipo_cbte', label: 'Tipo de comprobante' },
  { key: 'punto_venta', label: 'Punto de venta' },
  { key: 'numero', label: 'Número' },
  { key: 'importe_total', label: 'Importe' },
  { key: 'fecha', label: 'Fecha' },
];

/**
 * T39 (pedido del cliente, 2026-08-23, feature 3 de 3 —
 * "posibilidad de ver ... los posibles match para validarlos
 * manualmente"). Decisión confirmada: modal de comparación campo por campo
 * al hacer click en la fila, con Confirmar/Descartar adentro — sin
 * reemplazar los botones rápidos inline que ya existían
 * (PeriodoReportViewer.tsx), sólo una vía alternativa más detallada para
 * la misma decisión.
 */
export function CoincidenciaModal({ row, onClose, onConfirmar, onDescartar, confirmando, descartando }: CoincidenciaModalProps) {
  const sistema = row.sistema;
  const arca = row.arca;
  if (!sistema || !arca) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Comparar posible coincidencia"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Comparar posible coincidencia</h3>
            {row.similarity_reason && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{row.similarity_reason}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="focus-ring shrink-0 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2 font-medium">Campo</th>
                <th className="px-3 py-2 font-medium">Contabilidad</th>
                <th className="px-3 py-2 font-medium">ARCA</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(({ key, label }) => {
                const sistemaValue = sistema[key] ?? '—';
                const arcaValue = arca[key] ?? '—';
                const differs = String(sistemaValue) !== String(arcaValue);
                return (
                  <tr key={key} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                    <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-400">{label}</td>
                    <td
                      className={`px-3 py-2 ${
                        differs ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {String(sistemaValue)}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        differs ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {String(arcaValue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(onConfirmar || onDescartar) && (
          <div className="flex justify-end gap-3">
            {onDescartar && (
              <button
                type="button"
                onClick={onDescartar}
                disabled={confirmando || descartando}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {descartando ? <SpinnerIcon size={14} /> : <XIcon size={14} />}
                Descartar
              </button>
            )}
            {onConfirmar && (
              <button
                type="button"
                onClick={onConfirmar}
                disabled={confirmando || descartando}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmando ? <SpinnerIcon size={14} /> : <CheckIcon size={14} />}
                Confirmar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
