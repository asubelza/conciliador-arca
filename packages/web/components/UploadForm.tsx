'use client';

import { useState, type FormEvent } from 'react';
import {
  CONTABILIDAD_SOURCE_SYSTEMS,
  previewReconciliation,
  uploadReconciliation,
  type ContabilidadSourceSystem,
  type PreviewResult,
} from '@/lib/api';
import { FilePreviewTable } from './FilePreviewTable';
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
 * T13/T37: formulario de carga en 2 pasos (pedido del cliente, 2026-08-23,
 * feature 1 de 3 — "previsualización... con un diseño de tabla"). Decisión
 * confirmada: previsualizar "después de subir, antes de procesar".
 *
 * Paso 1 (elegir archivos): el contador selecciona el sistema contable y
 * ambos archivos y pide previsualizar — esto envía los archivos a
 * POST /api/reconciliations/preview (mismo parseo/adaptadores que usa el
 * worker real, sin escribir nada en la base ni encolar un job).
 *
 * Paso 2 (previsualizar y confirmar): se muestra FilePreviewTable con el
 * resultado. Si el contador confirma, se reenvían los MISMOS dos objetos
 * File (conservados en el estado del componente) a uploadReconciliation()
 * — la carga real, que sí encola el job de conciliación. "Volver" descarta
 * la previsualización sin perder el sistema contable ya elegido.
 *
 * T30 (RF-13, conciliacion-periodica): `tenant_id` y `periodo_id` siguen
 * siendo props, no campos de este formulario — PeriodoSelector es donde el
 * contador elige/crea el período, un paso antes de este.
 */
export function UploadForm({ tenantId, periodoId, onUploaded }: UploadFormProps) {
  const [contabilidadSourceSystem, setContabilidadSourceSystem] = useState<ContabilidadSourceSystem>('tango');
  const [arcaFile, setArcaFile] = useState<File | null>(null);
  const [contabilidadFile, setContabilidadFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!arcaFile || !contabilidadFile) {
      setError('Both ARCA and contabilidad files are required');
      return;
    }

    setPreviewing(true);
    try {
      const res = await previewReconciliation({
        tenantId,
        periodoId,
        contabilidadSourceSystem,
        arcaFile,
        contabilidadFile,
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!arcaFile || !contabilidadFile) return;
    setError(null);
    setConfirming(true);
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
      setConfirming(false);
    }
  }

  function handleBack() {
    setPreview(null);
    setError(null);
  }

  if (preview) {
    return (
      <div className="flex max-w-3xl flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Previsualización</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Así se están leyendo los datos de los dos archivos. Revisalos y confirmá para conciliar de verdad.
          </p>
        </div>

        <FilePreviewTable preview={preview} />

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={confirming}
            className="focus-ring rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirming && <SpinnerIcon size={16} />}
            {confirming ? 'Confirmando…' : 'Confirmar y conciliar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handlePreview}
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
        disabled={previewing}
        className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {previewing && <SpinnerIcon size={16} />}
        {previewing ? 'Previsualizando…' : 'Previsualizar'}
      </button>
    </form>
  );
}
