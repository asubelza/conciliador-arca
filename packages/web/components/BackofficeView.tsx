'use client';

import { useState } from 'react';
import { BackofficeTenants } from './BackofficeTenants';
import { BackofficeUsers } from './BackofficeUsers';

type BackofficeTab = 'tenants' | 'usuarios';

/**
 * Backoffice self-service (admin-only): Tenants (PR1)/Usuarios (PR4) tab
 * switcher. Composed by app/page.tsx in place of the tenant/período flow
 * when the admin-only "Backoffice" header button is active — independent
 * of that flow's own View tabs (Dashboard/Circuito/Reporte/Histórico),
 * which are gated on having a período selected.
 */
export function BackofficeView() {
  const [tab, setTab] = useState<BackofficeTab>('tenants');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-fit gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setTab('tenants')}
          className={`focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === 'tenants' ? 'bg-indigo-600 text-white shadow-card' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
        >
          Tenants
        </button>
        <button
          type="button"
          onClick={() => setTab('usuarios')}
          className={`focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === 'usuarios' ? 'bg-indigo-600 text-white shadow-card' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
        >
          Usuarios
        </button>
      </div>

      {tab === 'tenants' ? <BackofficeTenants /> : <BackofficeUsers />}
    </div>
  );
}
