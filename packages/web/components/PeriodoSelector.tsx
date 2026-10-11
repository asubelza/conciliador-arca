'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/session';
import { TenantConfigPanel } from './TenantConfigPanel';

export interface PeriodoSelectorProps {
  /** AD-6 (dashboard-principal): only yields the tenantId — período
   * list/create/reopen/delete now live in Dashboard (RF-24..RF-28). */
  onSelected: (tenantId: string) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * T30 (RF-12/RF-13, conciliacion-periodica) + AD-6 (dashboard-principal):
 * pure tenant-entry step — the UUID paste step stays exactly as before
 * (RF-24), but this component no longer fetches or lists períodos; that
 * responsibility moved into `Dashboard.tsx` so there's a single source of
 * truth for the período list (one `listPeriodos` call, partitioned
 * client-side). The admin-only tolerance config toggle stays here per
 * design's component diagram ("PeriodoSelector: tenant entry + admin
 * TenantConfigPanel").
 *
 * Tenant-existence validation was attempted here via a `listPeriodos(id)`
 * round-trip, but removed again: `GET /api/periodos` never checks a
 * `tenants` table for admin/colaborador roles, it just returns
 * `200 {periodos: []}` for ANY syntactically-valid UUID, identical to a
 * real empty tenant — so the round-trip validated nothing and only added
 * a network call plus a fake "Verificando…" spinner. A real fix needs a
 * backend endpoint that actually checks tenant existence; that's out of
 * scope for this frontend-only change (follow-up).
 */
export function PeriodoSelector({ onSelected }: PeriodoSelectorProps) {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const [confirmedTenantId, setConfirmedTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const id = tenantId.trim();
    if (!UUID_RE.test(id)) {
      setError('tenant_id is required and must be a UUID');
      setConfirmedTenantId(null);
      return;
    }
    setError(null);
    setConfirmedTenantId(id);
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <form
        onSubmit={handleSubmit}
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
            className="focus-ring inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            Ingresar
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
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
