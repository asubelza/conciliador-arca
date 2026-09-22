'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPendientesHistorico, type PendientesHistoricoResult } from '@/lib/api';
import { listPeriodos } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { PendientesArcaChart } from './PendientesArcaChart';
import { PeriodoReportViewer } from './PeriodoReportViewer';
import { PendientesHistoricoViewer } from './PendientesHistoricoViewer';
import { SpinnerIcon, WarningIcon } from './icons';

export interface Periodo {
  id: string;
  tenant_id: string;
  mes: string;
  estado: 'abierto' | 'cerrado';
  tolerancia_ars: string | null;
  cerrado_at: string | null;
  cerrado_por: string | null;
  created_at?: string;
}

/** Section A: Período en curso */
interface SectionAProps {
  periodos: Periodo[];
  userRole: 'admin' | 'colaborador' | 'cliente';
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenPeriodo: (periodo: Periodo) => void;
  onCreatePeriodo: () => void;
  onDeletePeriodo: (periodo: Periodo) => void;
}

/** Section B: Histórico */
interface SectionBProps {
  periodos: Periodo[];
  userRole: 'admin' | 'colaborador' | 'cliente';
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onViewReport: (periodo: Periodo) => void;
  onReopenPeriodo: (periodo: Periodo) => void;
}

/** RF-29: shared per-section error banner + retry button. */
function SectionErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-card dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
    >
      <span className="flex items-center gap-2">
        <WarningIcon size={16} className="shrink-0" />
        {error}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring self-start rounded text-sm font-medium text-red-700 underline hover:text-red-600 dark:text-red-400"
      >
        Reintentar
      </button>
    </div>
  );
}

/** RF-29: shared per-section loading spinner. */
function SectionSpinner({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      <SpinnerIcon size={16} /> {label}
    </p>
  );
}

/** Section C: Pendientes ARCA */
interface SectionCProps {
  tenantId: string;
  userRole: 'admin' | 'colaborador' | 'cliente';
  /** RF-24/RF-27: opens PendientesHistoricoViewer as an overlay swap inside the dashboard route. */
  onViewHistoricoCompleto: () => void;
}

/** Section A - Período en curso */
function SectionA({ periodos, userRole, loading, error, onRetry, onOpenPeriodo, onCreatePeriodo, onDeletePeriodo }: SectionAProps) {
  const [confirmPeriodo, setConfirmPeriodo] = useState<Periodo | null>(null);

  const handleConfirmDialogClose = () => setConfirmPeriodo(null);

  const handleConfirm = async () => {
    if (!confirmPeriodo) return;
    onDeletePeriodo(confirmPeriodo);
    setConfirmPeriodo(null);
  };

  const openPeriodos = periodos.filter((p) => p.estado === 'abierto');

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">
        Período en curso
      </h2>

      {error ? (
        <SectionErrorBanner error={error} onRetry={onRetry} />
      ) : loading ? (
        <SectionSpinner label="Cargando períodos…" />
      ) : (
        <div className="space-y-4">
          {openPeriodos.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Este tenant todavía no tiene períodos
            </p>
          ) : (
            openPeriodos.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white/50 dark:border-slate-700 dark:bg-slate-800/50">
                <span className="font-medium text-slate-800 dark:text-slate-100">{p.mes}</span>
                <div className="flex items-center gap-2">
                  {userRole === 'cliente' && (
                    <span className="text-xs font-medium text-slate-400 dark:text-slate-500">solo lectura</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenPeriodo(p)}
                    className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    Abrir
                  </button>
                  {userRole === 'admin' && (
                    <button
                      type="button"
                      onClick={() => setConfirmPeriodo(p)}
                      className="focus-ring rounded text-sm font-medium text-red-600 hover:text-red-500 dark:text-red-400"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {userRole !== 'cliente' && (
            <button
              type="button"
              onClick={onCreatePeriodo}
              className="focus-ring rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-indigo-500"
            >
              Crear nuevo período
            </button>
          )}
        </div>
      )}

      {confirmPeriodo && (
        <ConfirmDialog
          title="Eliminar período"
          text="¿Estás seguro de que deseas eliminar este período?"
          onConfirm={handleConfirm}
          onCancel={handleConfirmDialogClose}
        />
      )}
    </div>
  );
}

/** Section B - Histórico */
function SectionB({ periodos, userRole, loading, error, onRetry, onViewReport, onReopenPeriodo }: SectionBProps) {
  const [confirmPeriodo, setConfirmPeriodo] = useState<Periodo | null>(null);
  const closedPeriodos = periodos.filter((p) => p.estado === 'cerrado');

  const handleConfirm = () => {
    if (!confirmPeriodo) return;
    onReopenPeriodo(confirmPeriodo);
    setConfirmPeriodo(null);
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">
        Histórico
      </h2>

      {error ? (
        <SectionErrorBanner error={error} onRetry={onRetry} />
      ) : loading ? (
        <SectionSpinner label="Cargando histórico…" />
      ) : closedPeriodos.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No hay períodos cerrados
        </p>
      ) : (
        <div className="space-y-3">
          {closedPeriodos.map((p) => (
            <div key={p.id} className="p-3 rounded-lg border border-slate-200 bg-white/50 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{p.mes}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onViewReport(p)}
                    className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    Ver reporte
                  </button>
                  {(userRole === 'admin' || userRole === 'colaborador') && (
                    <button
                      type="button"
                      onClick={() => setConfirmPeriodo(p)}
                      className="focus-ring rounded text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmPeriodo && (
        <ConfirmDialog
          title="Reabrir período"
          text="¿Estás seguro de que deseas reabrir este período?"
          onConfirm={handleConfirm}
          onCancel={() => setConfirmPeriodo(null)}
        />
      )}
    </div>
  );
}

/** Section C - Pendientes ARCA */
function SectionC({ tenantId, userRole, onViewHistoricoCompleto }: SectionCProps) {
  const [result, setResult] = useState<PendientesHistoricoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getPendientesHistorico(tenantId);
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching pendientes históricos');
      }
    }
    load();
  }, [tenantId]);

  // Cliente role: read-only, show totals only, no chart editing
  if (userRole === 'cliente') {
    if (!result) {
      return (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <SpinnerIcon size={16} /> Cargando…
        </p>
      );
    }
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-3">
          Pendientes ARCA
        </h2>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-indigo-600 dark:text-indigo-400 text-2xl font-bold">
              {result.count_pendientes}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              total pendientes ARCA
            </p>
          </div>
          <div>
            <p className="text-indigo-600 dark:text-indigo-400 text-2xl font-bold">
              ${result.count_excluidos_previos_a_alta > 0 ? result.count_excluidos_previos_a_alta.toLocaleString('es-AR') : '0'}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              excluidos previos a alta
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onViewHistoricoCompleto}
          className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 underline cursor-pointer"
        >
          Ver histórico completo
        </button>
      </div>
    );
  }

  // Admin/Colaborador: show chart
  if (!result) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <SpinnerIcon size={16} /> Cargando gráfico de pendientes ARCA…
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <PendientesArcaChart result={result} />
      <button
        type="button"
        onClick={onViewHistoricoCompleto}
        className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 underline cursor-pointer"
      >
        Ver histórico completo
      </button>
    </div>
  );
}

/** Dashboard Shell - renders three sections A, B, C */
export interface DashboardShellProps {
  tenantId: string;
  userRole: 'admin' | 'colaborador' | 'cliente';
  onOpenPeriodo: (periodo: Periodo) => void;
  onCreatePeriodo: () => void;
  onReopenPeriodo: (periodo: Periodo) => void;
  onDeletePeriodo: (periodo: Periodo) => void;
  /** Optional: navigate to a closed período's report. Defaults to a no-op. */
  onViewReport?: (periodo: Periodo) => void;
}

export function DashboardShell({ tenantId, userRole, onOpenPeriodo, onCreatePeriodo, onReopenPeriodo, onDeletePeriodo, onViewReport }: DashboardShellProps) {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // RF-24/RF-27: "Ver histórico completo" swaps in PendientesHistoricoViewer
  // as an overlay WITHOUT leaving the dashboard route (page.tsx's `view`
  // stays 'dashboard' the whole time — this toggle is local to the shell).
  const [showHistoricoOverlay, setShowHistoricoOverlay] = useState(false);

  // RF-25/RF-29: Sections A+B share ONE listPeriodos call (partitioned
  // client-side by estado) — so its own loading/error state is per-fetch,
  // independent from Section C's separate pendientes-historico fetch.
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPeriodos(tenantId);
      setPeriodos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Períodos fetch failed');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Wrap the mutation callbacks so the dashboard's own copy of the list
  // refreshes after the action runs. The action itself lives in page.tsx
  // (which also re-fetches for its own selected-período state); this keeps
  // the Section A/B lists here in sync with the API.
  const afterMutation = async (action: () => void | Promise<void>) => {
    await action();
    await refresh();
  };

  if (showHistoricoOverlay) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShowHistoricoOverlay(false)}
          className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Volver al dashboard
        </button>
        <PendientesHistoricoViewer tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionA
        periodos={periodos || []}
        userRole={userRole}
        loading={loading}
        error={error}
        onRetry={refresh}
        onOpenPeriodo={onOpenPeriodo}
        onCreatePeriodo={() => afterMutation(onCreatePeriodo)}
        onDeletePeriodo={(p) => afterMutation(() => onDeletePeriodo(p))}
      />
      <SectionB
        periodos={periodos || []}
        userRole={userRole}
        loading={loading}
        error={error}
        onRetry={refresh}
        onViewReport={onViewReport ?? (() => {})}
        onReopenPeriodo={(p) => afterMutation(() => onReopenPeriodo(p))}
      />
      <SectionC
        tenantId={tenantId}
        userRole={userRole}
        onViewHistoricoCompleto={() => setShowHistoricoOverlay(true)}
      />
    </div>
  );
}