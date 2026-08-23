import ExcelJS from 'exceljs';
import { buildDiffReportRows, toCsv, toXlsxBuffer } from './report-generator';
import type { PersistedResultRow } from './report-generator';
import { Classification } from 'shared-types';
import type { CanonicalVoucher } from 'shared-types';

/**
 * T11 — RF-10 (reconciliation-reporting.spec.md).
 */
function voucher(overrides: Partial<CanonicalVoucher> = {}): CanonicalVoucher {
  return {
    cuit_emisor: '30123456789',
    tipo_cbte: 1,
    punto_venta: 1,
    numero: 1,
    fecha_emision: '2021-01-01',
    importe_total_ars: 100,
    iva: 21,
    moneda: 'ARS',
    file_source: 'arca',
    source_row: {},
    ...overrides,
  };
}

describe('T11 RF-10: buildDiffReportRows', () => {
  it('AC scenario: matched pair with delta (1500.00 vs 1499.00 -> delta 1.00)', () => {
    const dbRow: PersistedResultRow = {
      tipo_clasificacion: Classification.Matched,
      composite_key: '30123456789|1|1|1',
      arca_row: voucher({ importe_total_ars: 1500, file_source: 'arca' }),
      contabilidad_row: voucher({ importe_total_ars: 1499, file_source: 'contabilidad' }),
      iva_impacto: '21.00',
    };
    const [row] = buildDiffReportRows([dbRow]);
    expect(row.classification).toBe('matched');
    expect(row.arca_importe).toBe(1500);
    expect(row.contabilidad_importe).toBe(1499);
    expect(row.delta).toBe(1);
  });

  it('AC scenario: 5 unmatched-arca rows, each with the arca side only', () => {
    const dbRows: PersistedResultRow[] = Array.from({ length: 5 }, (_, i) => ({
      tipo_clasificacion: Classification.UnmatchedArca,
      composite_key: `key-${i}`,
      arca_row: voucher({ numero: i }),
      contabilidad_row: null,
      iva_impacto: null,
    }));
    const rows = buildDiffReportRows(dbRows);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.classification === 'unmatched-arca')).toBe(true);
    expect(rows.every((r) => r.contabilidad_importe === null)).toBe(true);
  });

  it('excludes duplicates from the report (not part of RF-10s listed categories)', () => {
    const dbRows: PersistedResultRow[] = [
      {
        tipo_clasificacion: Classification.Duplicates,
        composite_key: 'dup',
        arca_row: voucher(),
        contabilidad_row: null,
        iva_impacto: null,
      },
    ];
    expect(buildDiffReportRows(dbRows)).toHaveLength(0);
  });

  it('orders each section by iva_amount DESC', () => {
    const dbRows: PersistedResultRow[] = [
      { tipo_clasificacion: Classification.UnmatchedArca, composite_key: 'a', arca_row: voucher(), contabilidad_row: null, iva_impacto: '50' },
      { tipo_clasificacion: Classification.UnmatchedArca, composite_key: 'b', arca_row: voucher(), contabilidad_row: null, iva_impacto: '2000' },
      { tipo_clasificacion: Classification.UnmatchedArca, composite_key: 'c', arca_row: voucher(), contabilidad_row: null, iva_impacto: '500' },
    ];
    const rows = buildDiffReportRows(dbRows);
    expect(rows.map((r) => r.iva_amount)).toEqual([2000, 500, 50]);
  });

  it('groups sections in order: matched, unmatched-arca, unmatched-contabilidad, errors', () => {
    const dbRows: PersistedResultRow[] = [
      { tipo_clasificacion: Classification.Errors, composite_key: 'e', arca_row: voucher(), contabilidad_row: null, iva_impacto: null },
      { tipo_clasificacion: Classification.Matched, composite_key: 'm', arca_row: voucher(), contabilidad_row: voucher({ file_source: 'contabilidad' }), iva_impacto: null },
      { tipo_clasificacion: Classification.UnmatchedContabilidad, composite_key: 'uc', arca_row: null, contabilidad_row: voucher({ file_source: 'contabilidad' }), iva_impacto: null },
      { tipo_clasificacion: Classification.UnmatchedArca, composite_key: 'ua', arca_row: voucher(), contabilidad_row: null, iva_impacto: null },
    ];
    const rows = buildDiffReportRows(dbRows);
    expect(rows.map((r) => r.classification)).toEqual(['matched', 'unmatched-arca', 'unmatched-contabilidad', 'errors']);
  });
});

describe('T11 RF-10: toCsv', () => {
  it('AC scenario: renders money fields with 2 decimals', () => {
    const csv = toCsv([
      {
        classification: 'matched',
        composite_key: '30123456789|1|1|1',
        arca_importe: 1500,
        contabilidad_importe: 1499,
        delta: 1,
        iva_amount: 21,
        cae: null,
        fecha_emision: '2021-01-01',
      },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('classification,composite_key,arca_importe,contabilidad_importe,delta,iva_amount,cae,fecha_emision');
    expect(lines[1]).toBe('matched,30123456789|1|1|1,1500.00,1499.00,1.00,21,,2021-01-01');
  });

  it('renders an empty CSV (header only) for no rows', () => {
    expect(toCsv([]).trim()).toBe('classification,composite_key,arca_importe,contabilidad_importe,delta,iva_amount,cae,fecha_emision');
  });
});

describe('T11 RF-10: toXlsxBuffer', () => {
  it('AC scenario: produces a valid Excel workbook with 4 named sheets', async () => {
    const buffer = await toXlsxBuffer([
      { classification: 'matched', composite_key: 'k1', arca_importe: 100, contabilidad_importe: 100, delta: 0, iva_amount: 21, cae: null, fecha_emision: null },
      { classification: 'unmatched-arca', composite_key: 'k2', arca_importe: 50, contabilidad_importe: null, delta: null, iva_amount: 10, cae: null, fecha_emision: null },
    ]);

    const workbook = new ExcelJS.Workbook();
    // exceljs's Buffer type param doesn't line up with Node's own Buffer
    // typing across versions — a pure type-declaration mismatch, not a
    // real incompatibility (toXlsxBuffer's return value loads back fine).
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(['Matched', 'Unmatched ARCA', 'Unmatched Contabilidad', 'Errors']);

    const matchedSheet = workbook.getWorksheet('Matched')!;
    expect(matchedSheet.rowCount).toBe(2); // header + 1 data row
    expect(matchedSheet.getRow(2).getCell(2).value).toBe('k1');
  });

  it('2026-08-23 ("Ver pendientes sistema"): a narrowed `sections` list builds only that one sheet', async () => {
    const buffer = await toXlsxBuffer(
      [
        { classification: 'matched', composite_key: 'k1', arca_importe: 100, contabilidad_importe: 100, delta: 0, iva_amount: 21, cae: null, fecha_emision: null },
        { classification: 'unmatched-contabilidad', composite_key: 'k2', arca_importe: null, contabilidad_importe: 50, delta: null, iva_amount: 10, cae: null, fecha_emision: null },
      ],
      ['unmatched-contabilidad'],
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Unmatched Contabilidad']);
    expect(workbook.getWorksheet('Unmatched Contabilidad')!.rowCount).toBe(2); // header + 1 row
  });
});
