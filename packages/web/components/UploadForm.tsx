'use client';

import { useState, type FormEvent } from 'react';
import {
  CONTABILIDAD_SOURCE_SYSTEMS,
  uploadReconciliation,
  type ContabilidadSourceSystem,
} from '@/lib/api';

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-xl">
      <div className="flex flex-col gap-1">
        <label htmlFor="source-system" className="text-sm font-medium">
          Sistema contable
        </label>
        <select
          id="source-system"
          value={contabilidadSourceSystem}
          onChange={(e) => setContabilidadSourceSystem(e.target.value as ContabilidadSourceSystem)}
          className="border rounded px-3 py-2"
        >
          {CONTABILIDAD_SOURCE_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {SOURCE_SYSTEM_LABELS[system] ?? system}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="arca-file" className="text-sm font-medium">
          Archivo ARCA
        </label>
        <input
          id="arca-file"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => setArcaFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="contabilidad-file" className="text-sm font-medium">
          Archivo Contabilidad
        </label>
        <input
          id="contabilidad-file"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => setContabilidadFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {submitting ? 'Subiendo…' : 'Subir y conciliar'}
      </button>
    </form>
  );
}
