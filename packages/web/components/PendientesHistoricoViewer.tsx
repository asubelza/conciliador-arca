'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  archivarComprobanteArca,
  archivarComprobantesArcaLote,
  downloadPendientesHistoricoExcel,
  getPendientesHistorico,
  type ArchivarLoteSkipReason,
  type PendientesHistoricoResult,
  type PendientesHistoricoRow,
} from '@/lib/api';
import { AFIP_TIPOS_CADENCIAL, AFIP_TIPO_LABELS } from 'shared-types';
import { SpinnerIcon } from './icons';
import { ConfirmDialog } from './ConfirmDialog';
import { AgregarComprobanteArcaForm } from './AgregarComprobanteArcaForm';

const ARCHIVAR_SKIP_REASON_LABELS: Record<ArchivarLoteSkipReason, string> = {
  not_found: 'no encontrado',
  wrong_tenant: 'de otro tenant',
  wrong_file_source: 'no es un comprobante ARCA',
  already_conciliado: 'ya estaba conciliado',
  already_archivado: 'ya estaba archivado',
};

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

/**
 * 2026-10-12 (Histórico filters + "Archivar"): `selection`, when present,
 * adds a leading checkbox column (multi-select) and a trailing per-row
 * "Archivar" action — only ever passed for the `pendientes` bucket (see
 * PendientesHistoricoViewer below): archiving an already-archivado or
 * excluido-previo-a-alta row makes no sense, so those two tables never
 * receive this prop.
 */
interface VoucherTableSelection {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onArchivarRow: (row: PendientesHistoricoRow) => void;
}

function VoucherTable({
  rows,
  showAntiguedad,
  selection,
}: {
  rows: PendientesHistoricoRow[];
  showAntiguedad: boolean;
  selection?: VoucherTableSelection;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Sin filas.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {selection && <th className="px-3 py-2 font-medium" />}
            <th className="px-3 py-2 font-medium">Comprobante</th>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Importe</th>
            {showAntiguedad && <th className="px-3 py-2 font-medium">Antigüedad</th>}
            {selection && <th className="px-3 py-2 font-medium">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60"
            >
              {selection && (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar comprobante ${row.cuit_emisor} Tipo ${row.tipo_cbte} PV ${row.punto_venta} Nro ${row.numero}`}
                    checked={selection.selectedIds.has(row.id)}
                    onChange={() => selection.onToggle(row.id)}
                    className="focus-ring h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                  />
                </td>
              )}
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
              {selection && (
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => selection.onArchivarRow(row)}
                    className="focus-ring rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Archivar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 2026-10-12 (Histórico filters): a blank value means "no filter applied" for every field. */
interface HistoricoFilters {
  fechaDesde: string;
  fechaHasta: string;
  tipoCbte: string;
  cuit: string;
  importeMin: string;
  importeMax: string;
  antiguedadMin: string;
  antiguedadMax: string;
}

const EMPTY_FILTERS: HistoricoFilters = {
  fechaDesde: '',
  fechaHasta: '',
  tipoCbte: '',
  cuit: '',
  importeMin: '',
  importeMax: '',
  antiguedadMin: '',
  antiguedadMax: '',
};

/**
 * 2026-10-12 (Histórico filters): client-side, same "derive a filtered
 * array in-render from a few useState values, no refetch" approach as
 * PeriodoReportViewer.tsx's showOnlyPendientesSistema — applied uniformly
 * to every visible bucket (pendientes/excluidos/archivados) so a filter
 * never shows an inconsistent subset of the data already on screen.
 */
function matchesFilters(row: PendientesHistoricoRow, filters: HistoricoFilters): boolean {
  if (filters.fechaDesde && (!row.fecha || row.fecha < filters.fechaDesde)) return false;
  if (filters.fechaHasta && (!row.fecha || row.fecha > filters.fechaHasta)) return false;
  if (filters.tipoCbte !== '' && row.tipo_cbte !== Number(filters.tipoCbte)) return false;
  if (filters.cuit.trim() !== '' && !row.cuit_emisor.includes(filters.cuit.replace(/\D/g, ''))) return false;
  if (filters.importeMin !== '' && (row.importe_total === null || row.importe_total < Number(filters.importeMin))) return false;
  if (filters.importeMax !== '' && (row.importe_total === null || row.importe_total > Number(filters.importeMax))) return false;
  if (filters.antiguedadMin !== '' && (row.antiguedad_meses === null || row.antiguedad_meses < Number(filters.antiguedadMin))) return false;
  if (filters.antiguedadMax !== '' && (row.antiguedad_meses === null || row.antiguedad_meses > Number(filters.antiguedadMax))) return false;
  return true;
}

const filterInputClass =
  'focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const filterLabelClass = 'text-xs font-medium text-slate-600 dark:text-slate-400';

/**
 * 2026-10-12 (Histórico filters + "Archivar"): fecha/tipo/CUIT/importe/
 * antigüedad filters, applied client-side to every visible bucket, plus
 * optional "ver archivados" (a third VoucherTable card) and a checkbox-
 * driven bulk archivar flow — reuses the same filter bar for all of the
 * above, no second fetch on any interaction here.
 */
function FilterBar({ filters, onChange }: { filters: HistoricoFilters; onChange: (next: HistoricoFilters) => void }) {
  function set<K extends keyof HistoricoFilters>(key: K, value: HistoricoFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-fecha-desde" className={filterLabelClass}>Fecha desde</label>
          <input
            id="filtro-fecha-desde"
            type="date"
            value={filters.fechaDesde}
            onChange={(e) => set('fechaDesde', e.target.value)}
            className={filterInputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-fecha-hasta" className={filterLabelClass}>Fecha hasta</label>
          <input
            id="filtro-fecha-hasta"
            type="date"
            value={filters.fechaHasta}
            onChange={(e) => set('fechaHasta', e.target.value)}
            className={filterInputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-tipo" className={filterLabelClass}>Tipo de comprobante</label>
          <select
            id="filtro-tipo"
            value={filters.tipoCbte}
            onChange={(e) => set('tipoCbte', e.target.value)}
            className={filterInputClass}
          >
            <option value="">Todos</option>
            {AFIP_TIPOS_CADENCIAL.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo} — {AFIP_TIPO_LABELS[tipo]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-cuit" className={filterLabelClass}>CUIT (filtro)</label>
          <input
            id="filtro-cuit"
            type="text"
            value={filters.cuit}
            onChange={(e) => set('cuit', e.target.value)}
            className={filterInputClass}
            placeholder="30111111112"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-importe-min" className={filterLabelClass}>Importe mín.</label>
          <input
            id="filtro-importe-min"
            type="number"
            step="0.01"
            value={filters.importeMin}
            onChange={(e) => set('importeMin', e.target.value)}
            className={filterInputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-importe-max" className={filterLabelClass}>Importe máx.</label>
          <input
            id="filtro-importe-max"
            type="number"
            step="0.01"
            value={filters.importeMax}
            onChange={(e) => set('importeMax', e.target.value)}
            className={filterInputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-antiguedad-min" className={filterLabelClass}>Antigüedad mín. (meses)</label>
          <input
            id="filtro-antiguedad-min"
            type="number"
            min="0"
            step="1"
            value={filters.antiguedadMin}
            onChange={(e) => set('antiguedadMin', e.target.value)}
            className={filterInputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-antiguedad-max" className={filterLabelClass}>Antigüedad máx. (meses)</label>
          <input
            id="filtro-antiguedad-max"
            type="number"
            min="0"
            step="1"
            value={filters.antiguedadMax}
            onChange={(e) => set('antiguedadMax', e.target.value)}
            className={filterInputClass}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="focus-ring self-start rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        Limpiar filtros
      </button>
    </div>
  );
}

export function PendientesHistoricoViewer({ tenantId, initialResult, userRole }: PendientesHistoricoViewerProps) {
  const [result, setResult] = useState<PendientesHistoricoResult | null>(initialResult ?? null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoricoFilters>(EMPTY_FILTERS);
  const [showArchivados, setShowArchivados] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingArchivarRow, setConfirmingArchivarRow] = useState<PendientesHistoricoRow | null>(null);
  const [confirmingBulkArchivar, setConfirmingBulkArchivar] = useState(false);
  const [archivando, setArchivando] = useState(false);
  const [archivarError, setArchivarError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  const filteredPendientes = useMemo(
    () => (result ? result.pendientes.filter((row) => matchesFilters(row, filters)) : []),
    [result, filters],
  );
  const filteredExcluidos = useMemo(
    () => (result ? result.excluidos_previos_a_alta.filter((row) => matchesFilters(row, filters)) : []),
    [result, filters],
  );
  const filteredArchivados = useMemo(
    () => (result ? result.archivados.filter((row) => matchesFilters(row, filters)) : []),
    [result, filters],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /** Same two-step confirm-then-prompt order as PeriodoReportViewer.tsx's handleResolverPendiente: the ConfirmDialog opens first, the optional-nota prompt only runs once the user hits "Confirmar". */
  async function handleArchivarRow(row: PendientesHistoricoRow) {
    let nota: string | undefined;
    if (typeof window !== 'undefined') {
      const entered = window.prompt('Nota (opcional):');
      if (entered === null) {
        setConfirmingArchivarRow(null);
        return;
      }
      nota = entered.trim() === '' ? undefined : entered.trim();
    }
    setArchivarError(null);
    setArchivando(true);
    try {
      await archivarComprobanteArca(tenantId, row.id, nota);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await load();
    } catch (err) {
      setArchivarError(err instanceof Error ? err.message : 'Archivar comprobante failed');
    } finally {
      setArchivando(false);
      setConfirmingArchivarRow(null);
    }
  }

  async function handleBulkArchivar() {
    let nota: string | undefined;
    if (typeof window !== 'undefined') {
      const entered = window.prompt('Nota (opcional, aplica a todos los seleccionados):');
      if (entered === null) {
        setConfirmingBulkArchivar(false);
        return;
      }
      nota = entered.trim() === '' ? undefined : entered.trim();
    }
    setArchivarError(null);
    setArchivando(true);
    try {
      const { results } = await archivarComprobantesArcaLote(tenantId, Array.from(selectedIds), nota);
      // RNF-07 "nunca ocultar": the endpoint already reports skips instead
      // of an all-or-nothing rollback — the UI has to surface that, not
      // silently treat a partial result as full success.
      const skipped = results.filter((r) => r.status === 'skipped');
      if (skipped.length > 0) {
        const detail = skipped
          .map((r) => `${r.voucher_id} (${ARCHIVAR_SKIP_REASON_LABELS[r.reason ?? 'not_found']})`)
          .join(', ');
        setArchivarError(`${skipped.length} de ${results.length} no se archivaron: ${detail}`);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      setArchivarError(err instanceof Error ? err.message : 'Archivar comprobantes (lote) failed');
    } finally {
      setArchivando(false);
      setConfirmingBulkArchivar(false);
    }
  }

  /**
   * 2026-10-12 (Histórico filters + export): exports exactly what's
   * currently ON SCREEN — the 3 already-computed filtered arrays, with
   * `filteredArchivados` only included while "ver archivados" is checked
   * (matching exactly what the "Ver archivados" toggle shows/hides above),
   * never the whole unfiltered tenant dataset.
   */
  // Same ids the "Descargar" buttons below are disabled on when empty —
  // computed once so both agree on exactly what's exportable, instead of
  // the button's disabled check and handleDownload's payload drifting.
  const exportIds = [
    ...filteredPendientes.map((row) => row.id),
    ...filteredExcluidos.map((row) => row.id),
    ...(showArchivados ? filteredArchivados.map((row) => row.id) : []),
  ];

  async function handleDownload(format: 'xlsx' | 'csv') {
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadPendientesHistoricoExcel(tenantId, exportIds, format);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

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

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => handleDownload('csv')}
          disabled={downloading || exportIds.length === 0}
          title={exportIds.length === 0 ? 'No hay filas para exportar con los filtros actuales' : undefined}
          className="focus-ring rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Descargar CSV
        </button>
        <button
          type="button"
          onClick={() => handleDownload('xlsx')}
          disabled={downloading || exportIds.length === 0}
          title={exportIds.length === 0 ? 'No hay filas para exportar con los filtros actuales' : undefined}
          className="focus-ring rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Descargar Excel
        </button>
      </div>

      {downloadError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {downloadError}
        </p>
      )}

      <label className="inline-flex items-center gap-2 self-start text-sm font-medium text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={showArchivados}
          onChange={(e) => setShowArchivados(e.target.checked)}
          className="focus-ring h-4 w-4 rounded border-slate-300 dark:border-slate-700"
        />
        Ver archivados ({result.count_archivados})
      </label>

      {archivarError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {archivarError}
        </p>
      )}

      {userRole !== 'cliente' && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} seleccionado(s)
          </span>
          <button
            type="button"
            onClick={() => setConfirmingBulkArchivar(true)}
            className="focus-ring rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Archivar seleccionados ({selectedIds.size})
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Deseleccionar todo
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
          Pendientes desde el alta ({filteredPendientes.length} de {result.count_pendientes})
        </h3>
        <VoucherTable
          rows={filteredPendientes}
          showAntiguedad
          selection={
            userRole !== 'cliente'
              ? { selectedIds, onToggle: toggleSelect, onArchivarRow: setConfirmingArchivarRow }
              : undefined
          }
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-card dark:border-amber-900/60 dark:bg-amber-950/10">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Anteriores al alta ({filteredExcluidos.length} de {result.count_excluidos_previos_a_alta})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Comprobantes de ARCA pendientes con fecha anterior a la de alta (o sin fecha) — no se cuentan como
            pendientes reales, pero se muestran igual para detectar si se subió por error un archivo histórico.
          </p>
        </div>
        <VoucherTable rows={filteredExcluidos} showAntiguedad />
      </div>

      {showArchivados && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-slate-50/60 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/40">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-500" />
              Archivados ({filteredArchivados.length} de {result.count_archivados})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Comprobantes de ARCA que un contador marcó como "no relevante" — ya no participan de ningún matching
              futuro, pero se muestran acá para que nada quede oculto.
            </p>
          </div>
          <VoucherTable rows={filteredArchivados} showAntiguedad />
        </div>
      )}

      {confirmingArchivarRow && (
        <ConfirmDialog
          title="Archivar comprobante"
          text={`¿Archivar el comprobante ${confirmingArchivarRow.cuit_emisor} · Tipo ${confirmingArchivarRow.tipo_cbte} · PV ${confirmingArchivarRow.punto_venta} · Nro ${confirmingArchivarRow.numero}? Deja de participar en cualquier matching futuro.`}
          onConfirm={() => handleArchivarRow(confirmingArchivarRow)}
          onCancel={() => setConfirmingArchivarRow(null)}
          isLoading={archivando}
        />
      )}

      {confirmingBulkArchivar && (
        <ConfirmDialog
          title="Archivar seleccionados"
          text={`¿Archivar ${selectedIds.size} comprobante(s) seleccionados? Dejan de participar en cualquier matching futuro.`}
          onConfirm={handleBulkArchivar}
          onCancel={() => setConfirmingBulkArchivar(false)}
          isLoading={archivando}
        />
      )}
    </div>
  );
}
