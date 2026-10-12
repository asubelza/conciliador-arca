'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  confirmarCoincidencia,
  desarchivarComprobanteArca,
  getPendientesHistorico,
  type PendientesHistoricoResult,
  type PendientesHistoricoRow,
} from '@/lib/api';
import { SpinnerIcon, XIcon } from './icons';
import { AgregarComprobanteArcaForm } from './AgregarComprobanteArcaForm';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface MatchManualModalProps {
  periodoId: string;
  /** The `no_existe_en_arca` row's `row.sistema.id` — the sistema-contable voucher this modal is finding an ARCA pair for. */
  sistemaVoucherId: string;
  tenantId: string;
  onClose: () => void;
  /** Called after a successful pairing, so the caller can refresh its report (same pattern as every other mutation callback in PeriodoReportViewer.tsx). */
  onMatched: () => void;
}

type Tab = 'buscar' | 'agregar' | 'archivados';

const TABS: { key: Tab; label: string }[] = [
  { key: 'buscar', label: 'Buscar pendientes ARCA' },
  { key: 'agregar', label: 'Agregar comprobante' },
  { key: 'archivados', label: 'Buscar en archivados' },
];

function matchesQuery(row: PendientesHistoricoRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    row.cuit_emisor.toLowerCase().includes(q) ||
    String(row.tipo_cbte).includes(q) ||
    String(row.numero).includes(q)
  );
}

function rowLabel(row: PendientesHistoricoRow): string {
  return `${row.cuit_emisor} · Tipo ${row.tipo_cbte} · PV ${row.punto_venta} · Nro ${row.numero}`;
}

/**
 * 2026-10-12 ("Match manual" para filas `no_existe_en_arca`): un comprobante
 * del sistema contable sin ningún par ARCA — el contador puede buscar un
 * pendiente ARCA existente, agregar uno nuevo a mano (reusa
 * AgregarComprobanteArcaForm) o rescatar uno que se archivó por error. Las
 * tres acciones terminan en el mismo lugar: POST
 * /api/periodos/:id/coincidencias (confirmarCoincidencia, sin cambios —
 * acepta cualquier par sistema+arca del mismo tenant, no requiere una
 * sugerencia fuzzy previa).
 *
 * Shell basado en ConfirmDialog.tsx (focus trap real, Escape, backdrop) —
 * NO en CoincidenciaModal.tsx, que no tiene trap — porque este modal tiene
 * pestañas internas y varias acciones encadenadas (desarchivar ->
 * confirmar), así que vale la pena la implementación completa.
 */
export function MatchManualModal({ periodoId, sistemaVoucherId, tenantId, onClose, onMatched }: MatchManualModalProps) {
  const [tab, setTab] = useState<Tab>('buscar');
  const [result, setResult] = useState<PendientesHistoricoResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [query, setQuery] = useState('');
  const [busyVoucherId, setBusyVoucherId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busyVoucherId);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busyVoucherId;
  }, [onClose, busyVoucherId]);

  const loadPendientes = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const data = await getPendientesHistorico(tenantId);
      setResult(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Pendientes histórico failed');
    } finally {
      setLoadingList(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadPendientes();
  }, [loadPendientes]);

  // Same focus-management pattern as ConfirmDialog.tsx: move focus into the
  // dialog on mount, trap Tab/Shift+Tab within it, restore focus on unmount.
  // Mount-only (no deps) — onCloseRef/busyRef always read the latest value.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (closeButtonRef.current ?? dialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (busyRef.current) return;
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  async function handleUsarPendiente(row: PendientesHistoricoRow) {
    setActionError(null);
    setBusyVoucherId(row.id);
    try {
      await confirmarCoincidencia(periodoId, sistemaVoucherId, row.id, 'confirmar');
      onMatched();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Coincidencia failed');
    } finally {
      setBusyVoucherId(null);
    }
  }

  /**
   * The chosen voucher must stop being 'archivado' BEFORE the confirmación
   * — matchPeriodo excludes 'archivado' vouchers exactly like 'conciliado'
   * (periodo-matching-engine.ts), so a confirmación against one still
   * archivado would silently not take on the next report read. If
   * desarchivar fails (e.g. a race — someone else already resolved it),
   * stop here and surface the error — never call confirmarCoincidencia
   * against a voucher this call didn't actually un-archive.
   */
  async function handleUsarArchivado(row: PendientesHistoricoRow) {
    setActionError(null);
    setBusyVoucherId(row.id);
    try {
      await desarchivarComprobanteArca(tenantId, row.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Desarchivar comprobante failed');
      setBusyVoucherId(null);
      return;
    }
    try {
      await confirmarCoincidencia(periodoId, sistemaVoucherId, row.id, 'confirmar');
      onMatched();
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Coincidencia failed');
      // desarchivar already succeeded above — this row is 'pendiente' now,
      // not 'archivado' anymore. Refresh so it moves out of the archivados
      // list the user is looking at instead of appearing unchanged; a
      // retry click would otherwise call desarchivar again on a voucher
      // that's no longer archivado and get a confusing conflict back.
      void loadPendientes();
    } finally {
      setBusyVoucherId(null);
    }
  }

  function handleCreated() {
    void loadPendientes();
    setTab('buscar');
  }

  function renderList(rows: PendientesHistoricoRow[], onUsar: (row: PendientesHistoricoRow) => void) {
    const filtered = rows.filter((row) => matchesQuery(row, query));
    if (loadingList) {
      return (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <SpinnerIcon size={16} />
          Cargando…
        </p>
      );
    }
    if (filtered.length === 0) {
      return <p className="text-sm text-slate-500 dark:text-slate-400">Sin resultados.</p>;
    }
    return (
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {filtered.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <span className="text-slate-700 dark:text-slate-300">
              {rowLabel(row)} · {row.fecha ?? 'Sin fecha'} · {row.importe_total ?? '—'}
            </span>
            <button
              type="button"
              onClick={() => onUsar(row)}
              disabled={busyVoucherId === row.id}
              className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyVoucherId === row.id && <SpinnerIcon size={12} />}
              Usar este
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => !busyVoucherId && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Match manual"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Match manual</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={!!busyVoucherId}
            aria-label="Cerrar"
            className="focus-ring rounded p-1 text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`focus-ring rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {actionError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {actionError}
          </p>
        )}

        {listError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {listError}
          </p>
        )}

        {(tab === 'buscar' || tab === 'archivados') && (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar por CUIT, tipo o número…"
              aria-label="Filtrar"
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {tab === 'buscar'
              ? renderList(result?.pendientes ?? [], handleUsarPendiente)
              : renderList(result?.archivados ?? [], handleUsarArchivado)}
          </>
        )}

        {tab === 'agregar' && <AgregarComprobanteArcaForm tenantId={tenantId} onCreated={handleCreated} />}
      </div>
    </div>
  );
}
