'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getTenantConfig, updateTenantConfig } from '@/lib/api';

export interface TenantConfigPanelProps {
  tenantId: string;
}

/**
 * T32 (RF-18, conciliacion-periodica): a simple per-tenant tolerance
 * config editor — GET/PUT /api/tenants/:id/config
 * (tenants.tolerancia_redondeo_ars, default $0.99, T20).
 *
 * RF-13 follow-up: a second field, tolerancia_dias_fecha (default 5 días),
 * added alongside it — same per-tenant-config pattern, and the API
 * requires both fields on every PUT (tenants-validation.ts), so this form
 * always submits them together even though they're edited independently.
 */
export function TenantConfigPanel({ tenantId }: TenantConfigPanelProps) {
  const [value, setValue] = useState<string>('');
  const [diasFecha, setDiasFecha] = useState<string>('');
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
      setDiasFecha(String(config.tolerancia_dias_fecha));
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
    const parsedDias = Number(diasFecha);
    if (!Number.isInteger(parsedDias) || parsedDias < 0 || parsedDias > 365) {
      setError('tolerancia_dias_fecha must be a whole number of days between 0 and 365');
      return;
    }
    setSaving(true);
    try {
      const config = await updateTenantConfig(tenantId, parsed, parsedDias);
      setValue(config.tolerancia_redondeo_ars);
      setDiasFecha(String(config.tolerancia_dias_fecha));
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
    // noValidate: the inputs' min/max are UI hints, not the source of truth
    // — handleSubmit's own checks are what actually surface the error
    // message below. Without this, the browser's native HTML5 constraint
    // validation silently blocks the submit event for an out-of-range
    // value before handleSubmit ever runs, so this form's own error UI
    // (and audit trail) would never fire for that case.
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 border rounded p-3 mt-2">
      <div className="flex flex-col gap-2">
        <label htmlFor="tolerancia" className="text-sm font-medium">
          Tolerancia de redondeo (ARS)
        </label>
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
          className="border rounded px-3 py-2"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="tolerancia-dias" className="text-sm font-medium">
          Tolerancia de fecha (días) — para coincidencias por similitud
        </label>
        <input
          id="tolerancia-dias"
          type="number"
          step="1"
          min="0"
          max="365"
          value={diasFecha}
          onChange={(e) => {
            setDiasFecha(e.target.value);
            setSaved(false);
          }}
          className="border rounded px-3 py-2"
        />
      </div>
      <div>
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
