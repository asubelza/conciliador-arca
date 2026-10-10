'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPendientesHistorico, listPeriodos, type PendientesHistoricoResult, type Periodo } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { PendientesArcaChart } from './PendientesArcaChart';
import { PeriodoReportViewer } from './PeriodoReportViewer';
import { PendientesHistoricoViewer } from './PendientesHistoricoViewer';
import { SpinnerIcon, WarningIcon } from './icons';

export type { Periodo };

/**
 * `Date#toISOString()` is always UTC — for Argentina (UTC-3), the last ~3
 * hours of any day already report the next UTC month, so it can't be used
 * to default a "current month" picker to the user's actual local month.
 */
function currentLocalMonth(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Section A: Período en curso */
interface SectionAProps {
  periodos: Periodo[];
  userRole: 'admin' | 'colaborador' | 'cliente';
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenPeriodo: (periodo: Periodo) => void;
  onCreatePeriodo: (mes: string) => void | Promise<void>;
  onDeletePeriodo: (periodo: Periodo) => void | Promise<void>;
}

/** Section B: Histórico */
interface SectionBProps {
  periodos: Periodo[];
  userRole: 'admin' | 'colaborador' | 'cliente';
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onViewReport: (periodo: Periodo) => void;
  onReopenPeriodo: (periodo: Periodo) => void | Promise<void>;
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
  result: PendientesHistoricoResult | null;
  error: string | null;
  onRetry: () => void;
  userRole: 'admin' | 'colaborador' | 'cliente';
  /** RF-24/RF-27: opens PendientesHistoricoViewer as an overlay swap inside the dashboard route. */
  onViewHistoricoCompleto: () => void;
}

/**
 * Shared by SectionA/SectionB: tracks the período pending a destructive
 * confirm action, awaits the mutation before closing the dialog, and keeps
 * it in a loading state meanwhile (isLoading disables Confirmar/Cancelar)
 * so a second click can't fire a concurrent mutation against the same
 * período — same pattern, previously duplicated between both sections
 * (eliminar vs. reabrir), differing only in which action it ran.
 */
function useConfirmAction(action: (periodo: Periodo) => void | Promise<void>) {
  const [target, setTarget] = useState<Periodo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    if (!target) return;
    setIsLoading(true);
    try {
      await action(target);
    } finally {
      setIsLoading(false);
      setTarget(null);
    }
  };

  return { target, isLoading, open: setTarget, close: () => setTarget(null), handleConfirm };
}

/** Section A - Período en curso */
function SectionA({ periodos, userRole, loading, error, onRetry, onOpenPeriodo, onCreatePeriodo, onDeletePeriodo }: SectionAProps) {
  const { target: confirmPeriodo, isLoading: isDeleting, open, close, handleConfirm } = useConfirmAction(onDeletePeriodo);
  const [nuevoMes, setNuevoMes] = useState(() => currentLocalMonth());

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
                      onClick={() => open(p)}
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
            <div className="flex items-center gap-2">
              <label htmlFor="nuevo-periodo-mes" className="sr-only">
                Mes del nuevo período
              </label>
              <input
                id="nuevo-periodo-mes"
                type="month"
                value={nuevoMes}
                onChange={(e) => setNuevoMes(e.target.value)}
                className="focus-ring rounded border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={() => onCreatePeriodo(nuevoMes)}
                disabled={!nuevoMes}
                className="focus-ring rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Crear nuevo período
              </button>
            </div>
          )}
        </div>
      )}

      {confirmPeriodo && (
        <ConfirmDialog
          title="Eliminar período"
          text="¿Estás seguro de que deseas eliminar este período?"
          onConfirm={handleConfirm}
          onCancel={close}
          isLoading={isDeleting}
        />
      )}
    </div>
  );
}

/** Section B - Histórico */
function SectionB({ periodos, userRole, loading, error, onRetry, onViewReport, onReopenPeriodo }: SectionBProps) {
  const { target: confirmPeriodo, isLoading: isReopening, open, close, handleConfirm } = useConfirmAction(onReopenPeriodo);
  const closedPeriodos = periodos.filter((p) => p.estado === 'cerrado');

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
                      onClick={() => open(p)}
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
          onCancel={close}
          isLoading={isReopening}
        />
      )}
    </div>
  );
}

/** Section C - Pendientes ARCA */
function SectionC({ result, error, onRetry, userRole, onViewHistoricoCompleto }: SectionCProps) {
  // RF-29: a failed fetch must stop showing the loading spinner and surface
  // the shared error banner with retry (same pattern as Sections A/B),
  // checked BEFORE the `!result` loading branches below.
  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">
          Pendientes ARCA
        </h2>
        <SectionErrorBanner error={error} onRetry={onRetry} />
      </div>
    );
  }

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
              {result.count_excluidos_previos_a_alta > 0 ? result.count_excluidos_previos_a_alta.toLocaleString('es-AR') : '0'}
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
  onCreatePeriodo: (mes: string) => void | Promise<void>;
  onReopenPeriodo: (periodo: Periodo) => void | Promise<void>;
  onDeletePeriodo: (periodo: Periodo) => void | Promise<void>;
  /** Optional: navigate to a closed período's report. Defaults to a no-op. */
  onViewReport?: (periodo: Periodo) => void;
  /** Always-reachable escape hatch back to tenant-entry (PeriodoSelector) —
   * without this, a zero-período tenant or a cliente-role user has no way
   * back short of logging out, since the nav tabs only appear once a
   * período has been opened (see handleChangePeriodo in page.tsx). */
  onChangeTenant: () => void;
}

export function DashboardShell({ tenantId, userRole, onOpenPeriodo, onCreatePeriodo, onReopenPeriodo, onDeletePeriodo, onViewReport, onChangeTenant }: DashboardShellProps) {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // RF-24/RF-27: "Ver histórico completo" swaps in PendientesHistoricoViewer
  // as an overlay WITHOUT leaving the dashboard route (page.tsx's `view`
  // stays 'dashboard' the whole time — this toggle is local to the shell).
  const [showHistoricoOverlay, setShowHistoricoOverlay] = useState(false);

  // Guards refresh()'s post-await setState calls against firing after this
  // shell has unmounted (e.g. onCreatePeriodo's action navigates away to
  // 'circuit' as soon as it resolves, unmounting this shell before
  // afterMutation's subsequent `await refresh()` applies its result).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // RF-25/RF-29: Sections A+B share ONE listPeriodos call (partitioned
  // client-side by estado) — so its own loading/error state is per-fetch,
  // independent from Section C's separate pendientes-historico fetch.
  //
  // requestIdRef guards against concurrent, unsequenced refreshes: if two
  // calls overlap (e.g. a mutation firing before the initial fetch settles)
  // and the OLDER one resolves LAST, its stale response is ignored instead
  // of overwriting the newer, more accurate state (which could otherwise
  // resurrect a période that was just deleted/reopened).
  const requestIdRef = useRef(0);
  const refresh = useCallback(async () => {
    if (!isMountedRef.current) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listPeriodos(tenantId);
      if (!isMountedRef.current || requestIdRef.current !== requestId) return; // unmounted or stale — ignore
      setPeriodos(data);
    } catch (err) {
      if (!isMountedRef.current || requestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : 'Períodos fetch failed');
    } finally {
      if (isMountedRef.current && requestIdRef.current === requestId) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // RF-27: Section C's single pendientes-historico fetch, lifted up here
  // (rather than owned by SectionC itself) so the "Ver histórico completo"
  // overlay below can reuse this same result instead of
  // PendientesHistoricoViewer re-fetching the same tenant's data again.
  const [historicoResult, setHistoricoResult] = useState<PendientesHistoricoResult | null>(null);
  const [historicoError, setHistoricoError] = useState<string | null>(null);
  const historicoRequestIdRef = useRef(0);
  const loadHistorico = useCallback(async () => {
    const requestId = ++historicoRequestIdRef.current;
    setHistoricoError(null);
    try {
      const data = await getPendientesHistorico(tenantId);
      if (!isMountedRef.current || historicoRequestIdRef.current !== requestId) return; // unmounted or stale — ignore
      setHistoricoResult(data);
    } catch (err) {
      if (!isMountedRef.current || historicoRequestIdRef.current !== requestId) return;
      setHistoricoError(err instanceof Error ? err.message : 'Error fetching pendientes históricos');
    }
  }, [tenantId]);

  useEffect(() => {
    loadHistorico();
  }, [loadHistorico]);

  // Wrap the mutation callbacks so the dashboard's own copy of the list
  // refreshes after the action runs. The action itself lives in page.tsx
  // (which also re-fetches for its own selected-período state); this keeps
  // the Section A/B lists here in sync with the API.
  //
  // page.tsx's action handlers catch their own errors and surface them via
  // `dashboardError`, but they now rethrow after doing so — so a failed
  // mutation doesn't waste a refetch here (nothing actually changed). On
  // success, both the período list AND the pendientes-histórico data are
  // refreshed — reabrir/eliminar/crear can all change voucher pendiente
  // status, which Section C's chart/totals depend on.
  const afterMutation = async (action: () => void | Promise<void>) => {
    try {
      await action();
    } catch {
      return;
    }
    await Promise.all([refresh(), loadHistorico()]);
  };

  return (
    <div className="space-y-8">
      {/* Always reachable, regardless of período/view state — otherwise a
          zero-período tenant or cliente-role user has no way back to
          PeriodoSelector short of logging out, since the nav tabs in
          page.tsx only render once a período has been opened. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onChangeTenant}
          className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Cambiar tenant
        </button>
      </div>

      {showHistoricoOverlay ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowHistoricoOverlay(false)}
            className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            ← Volver al dashboard
          </button>
          <PendientesHistoricoViewer tenantId={tenantId} initialResult={historicoResult ?? undefined} />
        </div>
      ) : (
        <>
          <SectionA
            periodos={periodos || []}
            userRole={userRole}
            loading={loading}
            error={error}
            onRetry={refresh}
            onOpenPeriodo={onOpenPeriodo}
            onCreatePeriodo={(mes) => afterMutation(() => onCreatePeriodo(mes))}
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
            result={historicoResult}
            error={historicoError}
            onRetry={loadHistorico}
            userRole={userRole}
            onViewHistoricoCompleto={() => setShowHistoricoOverlay(true)}
          />
        </>
      )}
    </div>
  );
}