'use client';

import { useState, type FormEvent } from 'react';
import {
  CONTABILIDAD_SOURCE_SYSTEMS,
  uploadReconciliation,
  type ContabilidadSourceSystem,
} from '@/lib/api';
import { SpinnerIcon, UploadIcon } from './icons';

export interface UploadFormProps {
  tenantId: string;
  periodoId: string;
  onUploaded: (jobId: string) => void;
}

/**
 * Display labels for the dropdown. Falls back to the raw key for any
 * system not listed here (kept minimal — everything else was already just
 * showing its raw lowercase key before this map existed).
 */
const SOURCE_SYSTEM_LABELS: Partial<Record<ContabilidadSourceSystem, string>> = {
  libro_iva_compras: 'Libro de IVA Compras (reporte impreso)',
};

/**
 * T13: the two-file upload form (RF-01/RF-02/RF-03's client side).
 *
 * T30 (RF-13, conciliacion-periodica): `tenant_id` and `periodo_id` are now
 * props, not fields this form collects itself — PeriodoSelector (rendered
 * one step earlier in app/page.tsx) is where the accountant picks/creates
 * the período, so every upload from here on is already scoped to an open
 * período before this form ever mounts. This is also what fixes the 400
 * this form used to return: the API has required `periodo_id` since PR-4
 * (T19), but nothing on this screen sent one until now.
 */
export function UploadForm({ tenantId, periodoId, onUploaded }: UploadFormProps) {
  const [contabilidadSourceSystem, setContabilidadSourceSystem] = useState<ContabilidadSourceSystem>('tango');
  const [arcaFile, setArcaFile] = useState<File | null>(null);
  const [contabilidadFile, setContabilidadFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!arcaFile || !contabilidadFile) {
      setError('Both ARCA and contabilidad files are required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await uploadReconciliation({
        tenantId,
        periodoId,
        contabilidadSourceSystem,
        arcaFile,
        contabilidadFile,
      });
      onUploaded(res.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-xl flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="source-system" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Sistema contable
        </label>
        <select
          id="source-system"
          value={contabilidadSourceSystem}
          onChange={(e) => setContabilidadSourceSystem(e.target.value as ContabilidadSourceSystem)}
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {CONTABILIDAD_SOURCE_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {SOURCE_SYSTEM_LABELS[system] ?? system}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="arca-file" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Archivo ARCA
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
          <UploadIcon size={16} className="shrink-0 text-slate-400" />
          <input
            id="arca-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setArcaFile(e.target.files?.[0] ?? null)}
            className="focus-ring w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500 dark:text-slate-300"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contabilidad-file" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Archivo Contabilidad
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
          <UploadIcon size={16} className="shrink-0 text-slate-400" />
          <input
            id="contabilidad-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setContabilidadFile(e.target.files?.[0] ?? null)}
            className="focus-ring w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500 dark:text-slate-300"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting && <SpinnerIcon size={16} />}
        {submitting ? 'Subiendo…' : 'Subir y conciliar'}
      </button>
    </form>
  );
}
