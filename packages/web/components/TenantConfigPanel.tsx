'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getTenantConfig, updateTenantConfig } from '@/lib/api';
import { CheckIcon, SpinnerIcon } from './icons';

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
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <SpinnerIcon size={16} />
        Cargando configuración…
      </p>
    );
  }

  return (
    // noValidate: the inputs' min/max are UI hints, not the source of truth
    // — handleSubmit's own checks are what actually surface the error
    // message below. Without this, the browser's native HTML5 constraint
    // validation silently blocks the submit event for an out-of-range
    // value before handleSubmit ever runs, so this form's own error UI
    // (and audit trail) would never fire for that case.
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-2 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tolerancia" className="text-sm font-medium text-slate-700 dark:text-slate-300">
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
          className="focus-ring w-full max-w-[12rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tolerancia-dias" className="text-sm font-medium text-slate-700 dark:text-slate-300">
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
          className="focus-ring w-full max-w-[12rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>
      <div>
        <button
          type="submit"
          disabled={saving}
          className="focus-ring inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <SpinnerIcon size={16} />}
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <CheckIcon size={16} />
          Guardado.
        </p>
      )}
    </form>
  );
}
