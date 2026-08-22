'use client';

import { useState, type FormEvent } from 'react';
import { createPeriodo, listPeriodos, type Periodo } from '@/lib/api';
import { useAuth } from '@/lib/session';
import { TenantConfigPanel } from './TenantConfigPanel';

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
    <div className="flex flex-col gap-6 max-w-xl">
      <form onSubmit={handleLookup} className="flex flex-col gap-2">
        <label htmlFor="tenant-id" className="text-sm font-medium">
          Tenant ID (UUID)
        </label>
        <div className="flex gap-2">
          <input
            id="tenant-id"
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="border rounded px-3 py-2 flex-1"
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <button type="submit" disabled={loading} className="bg-gray-800 text-white rounded px-4 py-2 disabled:opacity-50">
            {loading ? 'Buscando…' : 'Buscar períodos'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      )}

      {lookedUpTenantId && periodos && (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Períodos existentes</h2>
            {periodos.length === 0 ? (
              <p className="text-sm text-gray-600">Este tenant todavía no tiene períodos.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {periodos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelected(lookedUpTenantId, p)}
                      className="w-full text-left border rounded px-3 py-2 hover:bg-gray-50 flex justify-between"
                    >
                      <span>{p.mes}</span>
                      <span className={p.estado === 'abierto' ? 'text-green-700' : 'text-gray-500'}>{p.estado}</span>
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
            <form onSubmit={handleCreate} className="flex flex-col gap-2">
              <label htmlFor="new-mes" className="text-sm font-medium">
                Nuevo período (mes)
              </label>
              <div className="flex gap-2">
                <input
                  id="new-mes"
                  type="month"
                  value={newMes}
                  onChange={(e) => setNewMes(e.target.value)}
                  className="border rounded px-3 py-2 flex-1"
                />
                <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2">
                  Crear período
                </button>
              </div>
            </form>
          )}

          {/* PUT /api/tenants/:id/config is admin-only server-side — hidden
              for cliente/colaborador per architecture.md's frontend plan. */}
          {user?.role === 'admin' && (
            <div>
              <button type="button" onClick={() => setShowConfig((v) => !v)} className="text-sm underline text-gray-600">
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
