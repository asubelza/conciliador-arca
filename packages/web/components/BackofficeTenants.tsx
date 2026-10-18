'use client';

import { useCallback, useEffect, useState } from 'react';
import { listTenants, setTenantActive, type TenantRow } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { SpinnerIcon } from './icons';
import { TenantFormDialog } from './TenantFormDialog';

/**
 * Backoffice self-service (admin-only): tenant list + create/edit, the
 * first CRUD surface for `tenants` beyond its own matching-tolerance config
 * (TenantConfig/getTenantConfig/updateTenantConfig — unrelated fields, left
 * untouched). Not wired into app navigation here — BackofficeView composes
 * this alongside BackofficeUsers.
 */
export function BackofficeTenants() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{ tenant?: TenantRow } | null>(null);
  const [toggleTarget, setToggleTarget] = useState<TenantRow | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listTenants();
      setTenants(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSaved() {
    void load();
  }

  async function handleToggleConfirm() {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await setTenantActive(toggleTarget.id, !toggleTarget.active);
      setToggleTarget(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el tenant');
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tenants</h2>
        <button
          type="button"
          onClick={() => setDialogState({})}
          className="focus-ring rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nuevo tenant
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <SpinnerIcon size={16} />
          Cargando…
        </p>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No hay tenants todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">CUIT</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{tenant.name}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{tenant.cuit ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        tenant.active
                          ? 'inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }
                    >
                      {tenant.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setDialogState({ tenant })}
                        className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setToggleTarget(tenant)}
                        className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        {tenant.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogState && (
        <TenantFormDialog tenant={dialogState.tenant} onClose={() => setDialogState(null)} onSaved={handleSaved} />
      )}

      {toggleTarget && (
        <ConfirmDialog
          title={toggleTarget.active ? 'Desactivar tenant' : 'Activar tenant'}
          text={`¿Estás seguro de que deseas ${toggleTarget.active ? 'desactivar' : 'activar'} a ${toggleTarget.name}?`}
          onConfirm={handleToggleConfirm}
          onCancel={() => setToggleTarget(null)}
          isLoading={toggling}
        />
      )}
    </div>
  );
}
