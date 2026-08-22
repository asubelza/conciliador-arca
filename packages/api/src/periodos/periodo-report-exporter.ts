/**
 * periodo-report-exporter.ts — CSV/XLSX export for the período report
 * (`periodo-report.ts`'s `getPeriodoReport`), added at the client's
 * explicit request (2026-08-22): "Si descargar en csv/xlsx con diseño
 * profesional" — until now `GET /api/periodos/:id/report` only supported
 * `format=json` (T29's original scope; see periodo-report.ts's module doc
 * for why that was deliberately deferred). The per-job report/export
 * (T11/T13, `report-generator.ts`) is untouched — this is a second,
 * separate exporter because the two reports have different shapes
 * (job-scoped 5-category taxonomy vs. período-scoped 3-section taxonomy;
 * see PR-6.md's design decision #1 for why they were never merged).
 *
 * "Diseño profesional" (the client's own words) is interpreted here as: a
 * title/subtitle block naming the tenant's período and its live/frozen
 * state, one sheet per section with a colored header row matching each
 * section's meaning (green = conciliado, amber = needs attention, slate =
 * still pending), frozen header + autofilter, real column widths, and
 * accounting-style number formatting — not just a bare data dump (compare
 * report-generator.ts's `toXlsxBuffer`, which is intentionally plain).
 */
import ExcelJS from 'exceljs';
import type { PeriodoReportResult, PeriodoReportRow, PeriodoReportSections } from './periodo-report';

export interface PeriodoExportRow {
  classification: PeriodoReportRow['classification'];
  cuit_emisor: string | null;
  tipo_cbte: number | null;
  punto_venta: number | null;
  numero: number | null;
  fecha_emision: string | null;
  importe_arca: number | null;
  importe_sistema: number | null;
  divergencia_ars: number | null;
  antiguedad_meses: number | null;
}

export interface PeriodoExportSections {
  conciliados_ok: PeriodoExportRow[];
  discrepancias_y_alertas: PeriodoExportRow[];
  pendientes_en_arca: PeriodoExportRow[];
}

/** Same labels the frontend uses (PeriodoReportViewer.tsx's CLASSIFICATION_LABELS) — kept in sync deliberately, so the on-screen report and the exported file never disagree on wording. */
export const CLASSIFICATION_LABELS: Record<PeriodoReportRow['classification'], string> = {
  conciliado_ok: 'Conciliado OK',
  con_divergencia: 'Con divergencia',
  posible_duplicado_en_sistema: 'Posible duplicado en sistema',
  no_existe_en_arca: 'No existe en ARCA',
  pendiente_en_arca: 'Pendiente en ARCA',
};

function toExportRow(row: PeriodoReportRow): PeriodoExportRow {
  const source = row.arca ?? row.sistema;
  return {
    classification: row.classification,
    cuit_emisor: source?.cuit_emisor ?? null,
    tipo_cbte: source?.tipo_cbte ?? null,
    punto_venta: source?.punto_venta ?? null,
    numero: source?.numero ?? null,
    fecha_emision: row.arca?.fecha ?? row.sistema?.fecha ?? null,
    importe_arca: row.arca?.importe_total ?? null,
    importe_sistema: row.sistema?.importe_total ?? null,
    divergencia_ars: row.divergencia_ars,
    antiguedad_meses: row.antiguedad_meses,
  };
}

/** Higher-impact rows first within each section — same "biggest amounts first" instinct as report-generator.ts's IVA-descending sort (RF-07: priorizar por impacto). */
function byImporteDesc(a: PeriodoExportRow, b: PeriodoExportRow): number {
  const impA = a.importe_arca ?? a.importe_sistema ?? 0;
  const impB = b.importe_arca ?? b.importe_sistema ?? 0;
  return impB - impA;
}

export function buildPeriodoExportSections(sections: PeriodoReportSections): PeriodoExportSections {
  return {
    conciliados_ok: sections.conciliados_ok.map(toExportRow).sort(byImporteDesc),
    discrepancias_y_alertas: sections.discrepancias_y_alertas.map(toExportRow).sort(byImporteDesc),
    pendientes_en_arca: sections.pendientes_en_arca.map(toExportRow).sort(byImporteDesc),
  };
}

const CSV_HEADERS = [
  'seccion',
  'clasificacion',
  'cuit_emisor',
  'tipo_cbte',
  'punto_venta',
  'numero',
  'fecha_emision',
  'importe_arca',
  'importe_sistema',
  'divergencia_ars',
  'antiguedad_meses',
] as const;

const MONEY_KEYS = new Set(['importe_arca', 'importe_sistema', 'divergencia_ars']);

function csvField(key: string, value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' && MONEY_KEYS.has(key) ? value.toFixed(2) : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const SECTION_LABELS: { key: keyof PeriodoExportSections; label: string }[] = [
  { key: 'conciliados_ok', label: 'Conciliados OK' },
  { key: 'discrepancias_y_alertas', label: 'Discrepancias y Alertas' },
  { key: 'pendientes_en_arca', label: 'Pendientes en ARCA' },
];

export function toPeriodoReportCsv(sections: PeriodoExportSections): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const { key, label } of SECTION_LABELS) {
    for (const row of sections[key]) {
      const record: Record<string, string | number | null> = { seccion: label, clasificacion: CLASSIFICATION_LABELS[row.classification], ...row };
      lines.push(CSV_HEADERS.map((h) => csvField(h, record[h])).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

// --- XLSX: "diseño profesional" ---------------------------------------

const HEADER_LABELS = [
  'Clasificación',
  'CUIT Emisor',
  'Tipo Comp.',
  'Pto. Venta',
  'Número',
  'Fecha Emisión',
  'Importe ARCA',
  'Importe Sistema',
  'Diferencia ($)',
  'Antigüedad (meses)',
];

const COLUMN_WIDTHS = [24, 16, 10, 10, 12, 14, 15, 15, 14, 16];

/** One accent color per section — green (all good), amber (needs review), slate (waiting on ARCA) — chosen to read clearly in both a printed report and on screen. */
const SECTION_STYLE: Record<keyof PeriodoExportSections, { title: string; headerFill: string; headerFont: string }> = {
  conciliados_ok: { title: 'Conciliados OK', headerFill: 'FF2E7D32', headerFont: 'FFFFFFFF' },
  discrepancias_y_alertas: { title: 'Discrepancias y Alertas', headerFill: 'FFB45309', headerFont: 'FFFFFFFF' },
  pendientes_en_arca: { title: 'Pendientes en ARCA', headerFill: 'FF334155', headerFont: 'FFFFFFFF' },
};

function fecha_dd_mm_yyyy(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function rowValues(row: PeriodoExportRow): (string | number | null)[] {
  return [
    CLASSIFICATION_LABELS[row.classification],
    row.cuit_emisor,
    row.tipo_cbte,
    row.punto_venta,
    row.numero,
    fecha_dd_mm_yyyy(row.fecha_emision),
    row.importe_arca,
    row.importe_sistema,
    row.divergencia_ars,
    row.antiguedad_meses,
  ];
}

function writeSectionSheet(
  workbook: ExcelJS.Workbook,
  key: keyof PeriodoExportSections,
  rows: PeriodoExportRow[],
  periodo: PeriodoReportResult['periodo'],
  live: boolean,
): void {
  const style = SECTION_STYLE[key];
  const sheet = workbook.addWorksheet(style.title, {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const lastCol = String.fromCharCode('A'.charCodeAt(0) + HEADER_LABELS.length - 1);

  sheet.mergeCells(`A1:${lastCol}1`);
  const title = sheet.getCell('A1');
  title.value = `Conciliación de Período — ${periodo.mes} — ${style.title}`;
  title.font = { bold: true, size: 14, color: { argb: 'FF111827' } };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 24;

  sheet.mergeCells(`A2:${lastCol}2`);
  const subtitle = sheet.getCell('A2');
  const estadoLabel = live ? 'Vista en vivo (el período sigue abierto)' : 'Snapshot congelado al momento del cierre';
  subtitle.value = `Estado: ${periodo.estado} — ${estadoLabel} — ${rows.length} comprobante(s)`;
  subtitle.font = { italic: true, size: 10, color: { argb: 'FF4B5563' } };

  const headerRow = sheet.getRow(4);
  headerRow.values = HEADER_LABELS;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: style.headerFont } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.headerFill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    };
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: HEADER_LABELS.length } };

  rows.forEach((row, i) => {
    const excelRow = sheet.addRow(rowValues(row));
    const zebra = i % 2 === 1;
    excelRow.eachCell((cell, colNumber) => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      };
      if (zebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
      const header = HEADER_LABELS[colNumber - 1];
      if (header === 'Importe ARCA' || header === 'Importe Sistema' || header === 'Diferencia ($)') {
        cell.numFmt = '#,##0.00';
      }
      if (header === 'Clasificación') {
        cell.font = { ...(cell.font ?? {}), color: { argb: 'FF111827' } };
      }
    });
  });

  if (rows.length === 0) {
    sheet.mergeCells(`A5:${lastCol}5`);
    const empty = sheet.getCell('A5');
    empty.value = 'Sin comprobantes en esta sección.';
    empty.font = { italic: true, color: { argb: 'FF6B7280' } };
  }
}

export async function toPeriodoReportXlsxBuffer(
  sections: PeriodoExportSections,
  periodo: PeriodoReportResult['periodo'],
  live: boolean,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Conciliador Inteligente de Comprobantes';
  workbook.created = new Date();

  for (const { key } of SECTION_LABELS) {
    writeSectionSheet(workbook, key, sections[key], periodo, live);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
