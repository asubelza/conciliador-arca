'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPendientesHistorico, type PendientesHistoricoResult, type PendientesHistoricoRow } from '@/lib/api';
import { SpinnerIcon } from './icons';

export interface PendientesHistoricoViewerProps {
  tenantId: string;
  /** Optional: an already-fetched result to render immediately, skipping
   * this component's own fetch — Dashboard's "Ver histórico completo"
   * overlay reuses Section C's own fetch instead of re-requesting the same
   * tenant's data a second time. Any other caller that doesn't pass this
   * keeps the component's original standalone fetch-on-mount behavior. */
  initialResult?: PendientesHistoricoResult;
}

/**
 * 2026-08-23 (client request, feature 3 de 3): "1 nueva pantalla donde
 * muestre el resumen de unmatch de arca... tomando como filtro desde el
 * mes en que por primera vez el cliente empezo a usar el sistema" —
 * reachable after cerrar un período (see app/page.tsx). Tenant-wide, not
 * scoped to any one período — this is the accumulated ARCA "pendiente"
 * stock across every período the tenant has ever had.
 *
 * `excluidos_previos_a_alta` gets its own, equally visible table rather
 * than being dropped (RNF-07: "nunca ocultar") — this is deliberately the
 * guard rail the client asked for: if a client mistakenly uploads a
 * historical ARCA file, those rows show up HERE, clearly labeled as
 * predating alta, instead of silently vanishing or silently polluting the
 * main pendientes list.
 */
function formatFecha(fecha: string | null): string {
  return fecha ?? 'Sin fecha';
}

function VoucherTable({ rows, showAntiguedad }: { rows: PendientesHistoricoRow[]; showAntiguedad: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Sin filas.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <th className="px-3 py-2 font-medium">Comprobante</th>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Importe</th>
            {showAntiguedad && <th className="px-3 py-2 font-medium">Antigüedad</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60"
            >
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                {row.cuit_emisor} · Tipo {row.tipo_cbte} · PV {row.punto_venta} · Nro {row.numero}
              </td>
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{formatFecha(row.fecha)}</td>
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.importe_total ?? '—'}</td>
              {showAntiguedad && (
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                  {row.antiguedad_meses === null ? '—' : `${row.antiguedad_meses} mes(es)`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PendientesHistoricoViewer({ tenantId, initialResult }: PendientesHistoricoViewerProps) {
  const [result, setResult] = useState<PendientesHistoricoResult | null>(initialResult ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getPendientesHistorico(tenantId);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pendientes histórico failed');
    }
  }, [tenantId]);

  useEffect(() => {
    if (initialResult) return; // already have data from the caller — skip the redundant fetch
    void load();
  }, [load, initialResult]);

  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!result) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <SpinnerIcon size={16} />
        Cargando histórico de pendientes…
      </p>
    );
  }

  const altaFecha = result.tenant.created_at.slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Histórico de Pendientes en ARCA — {result.tenant.name}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Cliente dado de alta en el sistema el {altaFecha}. Se muestra el stock de ARCA aún sin match acumulado en
          todos los períodos, filtrado a partir de esa fecha.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
          Pendientes desde el alta ({result.count_pendientes})
        </h3>
        <VoucherTable rows={result.pendientes} showAntiguedad />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-card dark:border-amber-900/60 dark:bg-amber-950/10">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Anteriores al alta ({result.count_excluidos_previos_a_alta})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Comprobantes de ARCA pendientes con fecha anterior a la de alta (o sin fecha) — no se cuentan como
            pendientes reales, pero se muestran igual para detectar si se subió por error un archivo histórico.
          </p>
        </div>
        <VoucherTable rows={result.excluidos_previos_a_alta} showAntiguedad />
      </div>
    </div>
  );
}
