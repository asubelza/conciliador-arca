'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createVoucherArcaManual,
  getPendientesHistorico,
  type PendientesHistoricoResult,
  type PendientesHistoricoRow,
} from '@/lib/api';
import { AFIP_TIPOS_CADENCIAL, AFIP_TIPO_LABELS } from 'shared-types';
import { SpinnerIcon } from './icons';

export interface PendientesHistoricoViewerProps {
  tenantId: string;
  /** Optional: an already-fetched result to render immediately, skipping
   * this component's own fetch — Dashboard's "Ver histórico completo"
   * overlay reuses Section C's own fetch instead of re-requesting the same
   * tenant's data a second time. Any other caller that doesn't pass this
   * keeps the component's original standalone fetch-on-mount behavior. */
  initialResult?: PendientesHistoricoResult;
  /**
   * 2026-10-12 (manual ARCA voucher creation): gates the "Agregar
   * comprobante ARCA" button — same `!== 'cliente'` posture as every other
   * mutating action in the dashboard (see Dashboard.tsx's SectionA/SectionB).
   */
  userRole: 'admin' | 'colaborador' | 'cliente';
}

const EMPTY_FORM = {
  cuit_emisor: '',
  tipo_cbte: String(AFIP_TIPOS_CADENCIAL[0]),
  punto_venta: '',
  numero: '',
  fecha_emision: '',
  importe_total_ars: '',
  iva: '',
};

/**
 * 2026-10-12 (manual ARCA voucher creation): a contador sometimes finds a
 * comprobante directly in AFIP's own portal that was never captured by any
 * uploaded ARCA file — this form registers it by hand via POST
 * /api/tenants/:id/comprobantes-arca so it enters the normal matching
 * engine as a regular pendiente ARCA voucher. Kept as inline state within
 * this file (not a separate component) since it's a single, self-contained
 * form with no reuse elsewhere, same call as TenantConfigPanel.tsx's own
 * small form.
 */
function AgregarComprobanteArcaForm({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
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

/**
 * 2026-08-23 (client request, feature 3 de 3): "1 nueva pantalla donde
 * muestre el resumen de unmatch de arca... tomando como filtro desde el
 * mes en que por primera vez el cliente empezo a usar el sistema" —
 * reachable after cerrar un período (see app/page.tsx). Tenant-wide, not
 * scoped to any one período — this is the accumulated ARCA "pendiente"
 * stock across every período the tenant has ever had.
 *
 * `excluidos_previos_a_alta` gets its own, equally visible table rather
 * than being dropped (RNF-07: "nunca ocultar") — this is deliberately the
 * guard rail the client asked for: if a client mistakenly uploads a
 * historical ARCA file, those rows show up HERE, clearly labeled as
 * predating alta, instead of silently vanishing or silently polluting the
 * main pendientes list.
 */
function formatFecha(fecha: string | null): string {
  return fecha ?? 'Sin fecha';
}

function VoucherTable({ rows, showAntiguedad }: { rows: PendientesHistoricoRow[]; showAntiguedad: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Sin filas.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <th className="px-3 py-2 font-medium">Comprobante</th>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Importe</th>
            {showAntiguedad && <th className="px-3 py-2 font-medium">Antigüedad</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60"
            >
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                {row.cuit_emisor} · Tipo {row.tipo_cbte} · PV {row.punto_venta} · Nro {row.numero}
              </td>
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{formatFecha(row.fecha)}</td>
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.importe_total ?? '—'}</td>
              {showAntiguedad && (
                <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                  {row.antiguedad_meses === null ? '—' : `${row.antiguedad_meses} mes(es)`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PendientesHistoricoViewer({ tenantId, initialResult, userRole }: PendientesHistoricoViewerProps) {
  const [result, setResult] = useState<PendientesHistoricoResult | null>(initialResult ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getPendientesHistorico(tenantId);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pendientes histórico failed');
    }
  }, [tenantId]);

  useEffect(() => {
    if (initialResult) return; // already have data from the caller — skip the redundant fetch
    void load();
  }, [load, initialResult]);

  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
        {error}
      </p>
    );
  }

  if (!result) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <SpinnerIcon size={16} />
        Cargando histórico de pendientes…
      </p>
    );
  }

  const altaFecha = result.tenant.created_at.slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Histórico de Pendientes en ARCA — {result.tenant.name}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Cliente dado de alta en el sistema el {altaFecha}. Se muestra el stock de ARCA aún sin match acumulado en
          todos los períodos, filtrado a partir de esa fecha.
        </p>
      </div>

      {userRole !== 'cliente' && (
        <AgregarComprobanteArcaForm tenantId={tenantId} onCreated={() => void load()} />
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
          Pendientes desde el alta ({result.count_pendientes})
        </h3>
        <VoucherTable rows={result.pendientes} showAntiguedad />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-card dark:border-amber-900/60 dark:bg-amber-950/10">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Anteriores al alta ({result.count_excluidos_previos_a_alta})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Comprobantes de ARCA pendientes con fecha anterior a la de alta (o sin fecha) — no se cuentan como
            pendientes reales, pero se muestran igual para detectar si se subió por error un archivo histórico.
          </p>
        </div>
        <VoucherTable rows={result.excluidos_previos_a_alta} showAntiguedad />
      </div>
    </div>
  );
}
