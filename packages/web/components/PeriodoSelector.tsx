'use client';

import { useState, type FormEvent } from 'react';
import { createPeriodo, listPeriodos, type Periodo } from '@/lib/api';
import { useAuth } from '@/lib/session';
import { TenantConfigPanel } from './TenantConfigPanel';
import { ChevronDownIcon, SpinnerIcon } from './icons';

export interface PeriodoSelectorProps {
  onSelected: (tenantId: string, periodo: Periodo) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * T30 (RF-12/RF-13, conciliacion-periodica): tenant lookup + período
 * alta/selección — the screen that now runs before UploadForm. This is
 * what makes uploads work again from the UI: `POST /api/reconciliations`
 * has required `periodo_id` since PR-4 (T19), and nothing upstream of
 * UploadForm ever collected one until this component existed (see
 * openspec/progress/PR-4.md's "known consequence for the current
 * frontend").
 */
export function PeriodoSelector({ onSelected }: PeriodoSelectorProps) {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const [lookedUpTenantId, setLookedUpTenantId] = useState<string | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newMes, setNewMes] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    const id = tenantId.trim();
    if (!UUID_RE.test(id)) {
      setError('tenant_id is required and must be a UUID');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const list = await listPeriodos(id);
      setPeriodos(list);
      setLookedUpTenantId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los períodos');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!lookedUpTenantId) return;
    if (!newMes.trim()) {
      setError('mes is required');
      return;
    }
    setError(null);
    try {
      const periodo = await createPeriodo(lookedUpTenantId, newMes.trim());
      onSelected(lookedUpTenantId, periodo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el período');
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <form
        onSubmit={handleLookup}
        className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        <label htmlFor="tenant-id" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Tenant ID (UUID)
        </label>
        <div className="flex gap-2">
          <input
            id="tenant-id"
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <button
            type="submit"
            disabled={loading}
            className="focus-ring inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            {loading && <SpinnerIcon size={16} />}
            {loading ? 'Buscando…' : 'Buscar períodos'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {lookedUpTenantId && periodos && (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Períodos existentes</h2>
            {periodos.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Este tenant todavía no tiene períodos.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {periodos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelected(lookedUpTenantId, p)}
                      className="focus-ring flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-700 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-100">{p.mes}</span>
                      <span className="flex items-center gap-2">
                        <span
                          className={
                            p.estado === 'abierto'
                              ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                              : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }
                        >
                          {p.estado}
                        </span>
                        <ChevronDownIcon size={16} className="-rotate-90 text-slate-400" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* T39 (Fase 3): cliente is read-only (RF-14) — POST /api/periodos is
              admin/colaborador-only server-side (assertRole in
              periodos.controller.ts), so a cliente never sees a form that
              would only 403 anyway. */}
          {user?.role !== 'cliente' && (
            <form
              onSubmit={handleCreate}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
            >
              <label htmlFor="new-mes" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Nuevo período (mes)
              </label>
              <div className="flex gap-2">
                <input
                  id="new-mes"
                  type="month"
                  value={newMes}
                  onChange={(e) => setNewMes(e.target.value)}
                  className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="submit"
                  className="focus-ring rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Crear período
                </button>
              </div>
            </form>
          )}

          {/* PUT /api/tenants/:id/config is admin-only server-side — hidden
              for cliente/colaborador per architecture.md's frontend plan. */}
          {user?.role === 'admin' && (
            <div>
              <button
                type="button"
                onClick={() => setShowConfig((v) => !v)}
                className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
              >
                {showConfig ? 'Ocultar configuración de tolerancia' : 'Configurar tolerancia de redondeo'}
              </button>
              {showConfig && <TenantConfigPanel tenantId={lookedUpTenantId} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
