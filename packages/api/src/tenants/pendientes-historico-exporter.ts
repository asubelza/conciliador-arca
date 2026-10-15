/**
 * pendientes-historico-exporter.ts — 2026-10-12 (Histórico filters +
 * export): CSV/XLSX export for `POST /api/tenants/:id/pendientes-historico/export`.
 * The row set is an arbitrary, caller-chosen subset of PendientesHistoricoRow
 * (see fetchVouchersForExport in pendientes-historico.ts) — always "whatever
 * the Histórico screen currently has visible after its client-side filters"
 * from PendientesHistoricoViewer.tsx's point of view, across any of its 3
 * buckets (pendientes/excluidos_previos_a_alta/archivados).
 *
 * Reuses periodo-report-exporter.ts's `styleHeaderRow` — the only piece of
 * that exporter's "diseño profesional" styling that isn't tied to
 * PeriodoExportRow's specific shape — instead of re-deriving header styling
 * here. Everything else about that exporter (per-section sheets/colors,
 * title/subtitle block, sort-by-impact) is specific to the período report's
 * 4-section taxonomy and doesn't apply to this flat, single-sheet export.
 */
import ExcelJS from 'exceljs';
import type { PendientesHistoricoRow } from './pendientes-historico';
import { styleHeaderRow } from '../periodos/periodo-report-exporter';

const ESTADO_LABELS: Record<PendientesHistoricoRow['estado'], string> = {
  pendiente: 'Pendiente',
  conciliado: 'Conciliado',
  archivado: 'Archivado',
};

// --- CSV -----------------------------------------------------------------

const CSV_HEADERS = [
  'cuit_emisor',
  'tipo_cbte',
  'punto_venta',
  'numero',
  'fecha',
  'importe_total',
  'iva',
  'estado',
  'antiguedad_meses',
] as const;

const MONEY_KEYS = new Set(['importe_total', 'iva']);

/** Same escaping convention as periodo-report-exporter.ts's csvField / report-generator.ts's csvField — kept consistent across every CSV writer in this codebase. */
function csvField(key: string, value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' && MONEY_KEYS.has(key) ? value.toFixed(2) : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toPendientesHistoricoCsv(rows: PendientesHistoricoRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    const record: Record<string, string | number | null> = {
      cuit_emisor: row.cuit_emisor,
      tipo_cbte: row.tipo_cbte,
      punto_venta: row.punto_venta,
      numero: row.numero,
      fecha: row.fecha,
      importe_total: row.importe_total,
      iva: row.iva,
      estado: ESTADO_LABELS[row.estado],
      antiguedad_meses: row.antiguedad_meses,
    };
    lines.push(CSV_HEADERS.map((h) => csvField(h, record[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

// --- XLSX ------------------------------------------------------------------

const HEADER_LABELS = [
  'CUIT Emisor',
  'Tipo Comp.',
  'Pto. Venta',
  'Número',
  'Fecha Emisión',
  'Importe',
  'IVA',
  'Estado',
  'Antigüedad (meses)',
];

const COLUMN_WIDTHS = [16, 10, 10, 12, 14, 14, 12, 12, 16];

/** Slate — same neutral tone periodo-report-exporter.ts uses for its own "still pending" section (pendientes_en_arca); this export has no multi-section taxonomy to color-code against. */
const HEADER_FILL = 'FF334155';
const HEADER_FONT = 'FFFFFFFF';

function rowValues(row: PendientesHistoricoRow): (string | number | null)[] {
  return [
    row.cuit_emisor,
    row.tipo_cbte,
    row.punto_venta,
    row.numero,
    row.fecha,
    row.importe_total,
    row.iva,
    ESTADO_LABELS[row.estado],
    row.antiguedad_meses,
  ];
}

export async function toPendientesHistoricoXlsxBuffer(rows: PendientesHistoricoRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Conciliador Inteligente de Comprobantes';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Pendientes en ARCA', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headerRow = sheet.getRow(1);
  headerRow.values = HEADER_LABELS;
  styleHeaderRow(headerRow, HEADER_FILL, HEADER_FONT);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADER_LABELS.length } };

  rows.forEach((row, i) => {
    const excelRow = sheet.addRow(rowValues(row));
    const zebra = i % 2 === 1;
    excelRow.eachCell((cell, colNumber) => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
      if (zebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
      const header = HEADER_LABELS[colNumber - 1];
      if (header === 'Importe' || header === 'IVA') {
        cell.numFmt = '#,##0.00';
      }
    });
  });

  if (rows.length === 0) {
    const empty = sheet.getCell('A2');
    empty.value = 'Sin comprobantes.';
    empty.font = { italic: true, color: { argb: 'FF6B7280' } };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
