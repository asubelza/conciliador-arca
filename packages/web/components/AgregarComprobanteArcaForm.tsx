'use client';

import { useState, type FormEvent } from 'react';
import { createVoucherArcaManual } from '@/lib/api';
import { AFIP_TIPOS_CADENCIAL, AFIP_TIPO_LABELS } from 'shared-types';
import { SpinnerIcon } from './icons';

const EMPTY_FORM = {
  cuit_emisor: '',
  tipo_cbte: String(AFIP_TIPOS_CADENCIAL[0]),
  punto_venta: '',
  numero: '',
  fecha_emision: '',
  importe_total_ars: '',
  iva: '',
};

export interface AgregarComprobanteArcaFormProps {
  tenantId: string;
  onCreated: () => void;
}

/**
 * 2026-10-12 (manual ARCA voucher creation): a contador sometimes finds a
 * comprobante directly in AFIP's own portal that was never captured by any
 * uploaded ARCA file — this form registers it by hand via POST
 * /api/tenants/:id/comprobantes-arca so it enters the normal matching
 * engine as a regular pendiente ARCA voucher.
 *
 * Extracted (2026-10-12, "Match manual" para no_existe_en_arca) from its
 * original home inside PendientesHistoricoViewer.tsx into its own file so
 * MatchManualModal.tsx's "Agregar comprobante" tab can reuse it unchanged —
 * same props shape it already had (`tenantId`, `onCreated`), same behavior.
 */
export function AgregarComprobanteArcaForm({ tenantId, onCreated }: AgregarComprobanteArcaFormProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const tipoCbte = Number(form.tipo_cbte);
    const puntoVenta = Number(form.punto_venta);
    const numero = Number(form.numero);
    const importeTotalArs = Number(form.importe_total_ars);
    const ivaTrimmed = form.iva.trim();
    const iva = ivaTrimmed === '' ? undefined : Number(ivaTrimmed);

    if (form.cuit_emisor.replace(/\D/g, '').length !== 11) {
      setError('cuit_emisor is required and must contain exactly 11 digits');
      return;
    }
    if (!Number.isInteger(puntoVenta) || puntoVenta < 0) {
      setError('punto_venta is required and must be a non-negative whole number');
      return;
    }
    if (!Number.isInteger(numero) || numero < 0) {
      setError('numero is required and must be a non-negative whole number');
      return;
    }
    if (!form.fecha_emision) {
      setError("fecha_emision is required and must be a valid ISO date ('YYYY-MM-DD')");
      return;
    }
    if (!Number.isFinite(importeTotalArs)) {
      setError('importe_total_ars is required and must be a finite number');
      return;
    }
    if (iva !== undefined && !Number.isFinite(iva)) {
      setError('iva must be a finite number when provided');
      return;
    }

    setSaving(true);
    try {
      await createVoucherArcaManual(tenantId, {
        cuit_emisor: form.cuit_emisor,
        tipo_cbte: tipoCbte,
        punto_venta: puntoVenta,
        numero,
        fecha_emision: form.fecha_emision,
        importe_total_ars: importeTotalArs,
        iva,
      });
      setSaved(true);
      setForm(EMPTY_FORM);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el comprobante');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Agregar comprobante ARCA
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-cuit" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            CUIT emisor
          </label>
          <input
            id="arca-cuit"
            type="text"
            value={form.cuit_emisor}
            onChange={(e) => update('cuit_emisor', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            placeholder="30111111112"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-tipo" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Tipo de comprobante
          </label>
          <select
            id="arca-tipo"
            value={form.tipo_cbte}
            onChange={(e) => update('tipo_cbte', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {AFIP_TIPOS_CADENCIAL.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo} — {AFIP_TIPO_LABELS[tipo]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-pv" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Punto de venta
          </label>
          <input
            id="arca-pv"
            type="number"
            min="0"
            step="1"
            value={form.punto_venta}
            onChange={(e) => update('punto_venta', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-numero" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Número
          </label>
          <input
            id="arca-numero"
            type="number"
            min="0"
            step="1"
            value={form.numero}
            onChange={(e) => update('numero', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-fecha" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Fecha de emisión
          </label>
          <input
            id="arca-fecha"
            type="date"
            value={form.fecha_emision}
            onChange={(e) => update('fecha_emision', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-importe" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Importe total (ARS)
          </label>
          <input
            id="arca-importe"
            type="number"
            step="0.01"
            value={form.importe_total_ars}
            onChange={(e) => update('importe_total_ars', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="arca-iva" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            IVA (opcional)
          </label>
          <input
            id="arca-iva"
            type="number"
            step="0.01"
            value={form.iva}
            onChange={(e) => update('iva', e.target.value)}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="focus-ring inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <SpinnerIcon size={16} />}
          {saving ? 'Guardando…' : 'Guardar comprobante'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setForm(EMPTY_FORM);
            setError(null);
            setSaved(false);
          }}
          className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Cancelar
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Comprobante registrado.</p>
      )}
    </form>
  );
}
