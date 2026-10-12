/**
 * report-generator.ts — T11 (RF-10): builds the diff-report rows from
 * persisted `reconciliation_results` and serializes them to CSV or XLSX.
 *
 * RF-10's CSV requirement explicitly lists matched, unmatched-arca,
 * unmatched-contabilidad and error rows — `duplicates` is a same-side
 * dedupe artifact already captured in the persisted classification, not
 * part of the accountant-facing diff, so it's excluded from the report by
 * design (see reconciliations.controller.ts's report query).
 */
import ExcelJS from 'exceljs';
import { Classification } from 'shared-types';
import type { CanonicalVoucher } from 'shared-types';

export interface PersistedResultRow {
  tipo_clasificacion: string;
  composite_key: string | null;
  arca_row: CanonicalVoucher | null;
  contabilidad_row: CanonicalVoucher | null;
  iva_impacto: string | number | null; // NUMERIC comes back as string from `pg`
}

export interface DiffReportRow {
  classification: string;
  composite_key: string;
  arca_importe: number | null;
  contabilidad_importe: number | null;
  delta: number | null;
  iva_amount: number | null;
  cae: string | null;
  fecha_emision: string | null;
}

const REPORT_SECTIONS = [
  Classification.Matched,
  Classification.UnmatchedArca,
  Classification.UnmatchedContabilidad,
  Classification.Errors,
] as const;

/** The 4 classifications this report ever surfaces — excludes 'duplicates' (see module doc). */
export type ReportSection = (typeof REPORT_SECTIONS)[number];

function toNumberOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * RF-10: CSV/XLSX both contain matched + unmatched-arca + unmatched-
 * contabilidad + errors, each section internally ordered by iva_amount
 * DESC ("the row is ordered by IVA amount descending").
 */
export function buildDiffReportRows(dbRows: PersistedResultRow[]): DiffReportRow[] {
  const bySection = new Map<string, DiffReportRow[]>();
  for (const section of REPORT_SECTIONS) bySection.set(section, []);

  for (const row of dbRows) {
    if (!bySection.has(row.tipo_clasificacion)) continue; // drop 'duplicates'

    const arcaImporte = row.arca_row?.importe_total_ars ?? null;
    const contabilidadImporte = row.contabilidad_row?.importe_total_ars ?? null;
    const delta = arcaImporte !== null && contabilidadImporte !== null ? arcaImporte - contabilidadImporte : null;

    bySection.get(row.tipo_clasificacion)!.push({
      classification: row.tipo_clasificacion,
      composite_key: row.composite_key ?? '',
      arca_importe: arcaImporte,
      contabilidad_importe: contabilidadImporte,
      delta,
      iva_amount: toNumberOrNull(row.iva_impacto),
      cae: row.arca_row?.cae ?? row.contabilidad_row?.cae ?? null,
      fecha_emision: row.arca_row?.fecha_emision ?? row.contabilidad_row?.fecha_emision ?? null,
    });
  }

  const result: DiffReportRow[] = [];
  for (const section of REPORT_SECTIONS) {
    const rows = bySection.get(section)!;
    rows.sort((a, b) => (b.iva_amount ?? 0) - (a.iva_amount ?? 0));
    result.push(...rows);
  }
  return result;
}

const CSV_HEADERS: (keyof DiffReportRow)[] = [
  'classification',
  'composite_key',
  'arca_importe',
  'contabilidad_importe',
  'delta',
  'iva_amount',
  'cae',
  'fecha_emision',
];

/** Money fields are rendered with 2 decimals (RF-10 scenario: "1500.00"). */
const MONEY_FIELDS = new Set<keyof DiffReportRow>(['arca_importe', 'contabilidad_importe', 'delta']);

function csvField(header: keyof DiffReportRow, value: string | number | null): string {
  if (value === null) return '';
  const s = typeof value === 'number' && MONEY_FIELDS.has(header) ? value.toFixed(2) : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows: DiffReportRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => csvField(h, row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

const SHEET_TITLES: Record<(typeof REPORT_SECTIONS)[number], string> = {
  [Classification.Matched]: 'Matched',
  [Classification.UnmatchedArca]: 'Unmatched ARCA',
  [Classification.UnmatchedContabilidad]: 'Unmatched Contabilidad',
  [Classification.Errors]: 'Errors',
};

/**
 * RF-10 "Download as Excel": one sheet per section, per the spec's
 * scenario. `sections` narrows which sheets get built — used by the
 * "Ver pendientes sistema" filtered download (2026-08-23, client request)
 * so filtering to `unmatched-contabilidad` produces one sheet with data
 * instead of one full sheet plus three empty ones.
 */
export async function toXlsxBuffer(
  rows: DiffReportRow[],
  sections: readonly ReportSection[] = REPORT_SECTIONS,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  for (const section of sections) {
    const sheet = workbook.addWorksheet(SHEET_TITLES[section]);
    sheet.addRow(CSV_HEADERS);
    for (const row of rows.filter((r) => r.classification === section)) {
      sheet.addRow(CSV_HEADERS.map((h) => row[h]));
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
