'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getTenantConfig, updateTenantConfig } from '@/lib/api';

export interface TenantConfigPanelProps {
  tenantId: string;
}

/**
 * T32 (RF-18, conciliacion-periodica): a simple per-tenant tolerance
 * config editor — GET/PUT /api/tenants/:id/config
 * (tenants.tolerancia_redondeo_ars, default $0.99, T20). Deliberately
 * minimal (one field, no history/audit view) — RF-18 only asks for the
 * value to be configurable, not for a management UI around it.
 */
export function TenantConfigPanel({ tenantId }: TenantConfigPanelProps) {
  const [value, setValue] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const config = await getTenantConfig(tenantId);
      setValue(config.tolerancia_redondeo_ars);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('tolerancia_redondeo_ars must be a non-negative number');
      return;
    }
    setSaving(true);
    try {
      const config = await updateTenantConfig(tenantId, parsed);
      setValue(config.tolerancia_redondeo_ars);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-600">Cargando configuración…</p>;
  }

  return (
    // noValidate: the input's min="0" is a UI hint, not the source of truth
    // — handleSubmit's own check is what actually surfaces the error
    // message below. Without this, the browser's native HTML5 constraint
    // validation silently blocks the submit event for an out-of-range
    // value before handleSubmit ever runs, so this form's own error UI
    // (and audit trail) would never fire for that case.
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2 border rounded p-3 mt-2">
      <label htmlFor="tolerancia" className="text-sm font-medium">
        Tolerancia de redondeo (ARS)
      </label>
      <div className="flex gap-2">
        <input
          id="tolerancia"
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className="border rounded px-3 py-2 flex-1"
        />
        <button type="submit" disabled={saving} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-green-700 text-sm">Guardado.</p>}
    </form>
  );
}
