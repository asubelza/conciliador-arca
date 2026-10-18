'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/session';
import { listMyTenants, type MyTenantRow } from '@/lib/api';
import { TenantConfigPanel } from './TenantConfigPanel';

export interface PeriodoSelectorProps {
  /** AD-6 (dashboard-principal): only yields the tenantId — período
   * list/create/reopen/delete now live in Dashboard (RF-24..RF-28). */
  onSelected: (tenantId: string) => void;
}

/**
 * T30 (RF-12/RF-13, conciliacion-periodica) + AD-6 (dashboard-principal) +
 * tenant-discovery: pure tenant-entry step. Fetches the caller's own
 * tenant(s) via listMyTenants() on mount and renders a `<select>` of
 * tenant NAMES (value = id) instead of the old manual UUID-paste input —
 * nothing in the login response, JWT, or GET /api/auth/me ever surfaced a
 * tenant id or name before this, so every role had to be handed a raw UUID
 * out of band. Everything after the tenant is chosen stays exactly as
 * before (the "Tenant <id>" confirmation box, the admin-only
 * TenantConfigPanel toggle, "Continuar al dashboard" calling onSelected) —
 * this component still yields only the tenantId string, same prop
 * contract as before. Período list/create responsibility stays in
 * Dashboard.tsx per design's component diagram.
 */
export function PeriodoSelector({ onSelected }: PeriodoSelectorProps) {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<MyTenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [confirmedTenantId, setConfirmedTenantId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listMyTenants()
      .then((rows) => {
        if (cancelled) return;
        setTenants(rows);
        if (rows.length > 0) {
          setSelectedTenantId(rows[0].id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'No se pudieron cargar los tenants');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTenantId) return;
    setConfirmedTenantId(selectedTenantId);
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      {loading && <p className="text-sm text-slate-600 dark:text-slate-300">Cargando tenants...</p>}

      {!loading && loadError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {loadError}
        </p>
      )}

      {!loading && !loadError && tenants.length === 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No tenés tenants asignados. Contactá a un administrador.
        </p>
      )}

      {!loading && !loadError && tenants.length > 0 && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900"
        >
          <label htmlFor="tenant-id" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Tenant
          </label>
          <div className="flex gap-2">
            <select
              id="tenant-id"
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              Ingresar
            </button>
          </div>
        </form>
      )}

      {confirmedTenantId && (
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Tenant <span className="font-mono">{confirmedTenantId}</span>
          </p>

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
              {showConfig && <TenantConfigPanel tenantId={confirmedTenantId} />}
            </div>
          )}

          <button
            type="button"
            onClick={() => onSelected(confirmedTenantId)}
            className="focus-ring self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Continuar al dashboard
          </button>
        </div>
      )}
    </div>
  );
}
