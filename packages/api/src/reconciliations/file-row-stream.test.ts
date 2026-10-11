/**
 * file-row-stream.test.ts — T05 (RF-03). Verifies the streaming CSV/XLSX
 * parsers produce header-keyed row objects from real files on disk.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { streamRowsFromFile } from './file-row-stream';

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('T05 RF-03: streamRowsFromFile', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-row-stream-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('parses a CSV file into header-keyed rows', async () => {
    const filePath = path.join(tmpDir, 'arca.csv');
    await fs.writeFile(
      filePath,
      'cuit,tipo,importe\n30111111112,1,"1.500,00"\n30222222223,3,"500,00"\n',
      'utf8',
    );

    const rows = await collect(streamRowsFromFile(filePath, 'csv'));
    expect(rows).toEqual([
      { cuit: '30111111112', tipo: '1', importe: '1.500,00' },
      { cuit: '30222222223', tipo: '3', importe: '500,00' },
    ]);
  });

  it('parses an XLSX file into header-keyed rows, skipping blank trailing rows', async () => {
    const filePath = path.join(tmpDir, 'contabilidad.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['CUIT', 'Tipo', 'Importe']);
    sheet.addRow(['30111111112', 'Factura A', 1500]);
    sheet.addRow(['30222222223', 'NC A', 500]);
    await workbook.xlsx.writeFile(filePath);

    const rows = await collect(streamRowsFromFile(filePath, 'xlsx'));
    expect(rows).toEqual([
      { CUIT: '30111111112', Tipo: 'Factura A', Importe: 1500 },
      { CUIT: '30222222223', Tipo: 'NC A', Importe: 500 },
    ]);
  });

  it('parses an XLS-labeled file via the buffered fallback (same shape as XLSX)', async () => {
    // xlsx (SheetJS) writes/reads .xls as BIFF8; we exercise it round-trip
    // via the .xlsx writer/reader pair since exceljs cannot itself emit
    // real legacy .xls, but XLSX.readFile understands both formats.
    const filePath = path.join(tmpDir, 'contabilidad-legacy.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['CUIT', 'Tipo']);
    sheet.addRow(['30111111112', 'Factura A']);
    await workbook.xlsx.writeFile(filePath);

    const rows = await collect(streamRowsFromFile(filePath, 'xls'));
    expect(rows).toEqual([{ CUIT: '30111111112', Tipo: 'Factura A' }]);
  });

  it('propagates a parse error for a corrupt XLSX file (RF-03 corrupt-file scenario)', async () => {
    const filePath = path.join(tmpDir, 'corrupt.xlsx');
    await fs.writeFile(filePath, 'this is not a real xlsx file', 'utf8');

    await expect(collect(streamRowsFromFile(filePath, 'xlsx'))).rejects.toBeTruthy();
  });

  it('sourceSystem "libro_iva_compras" bypasses the generic header-row XLSX reader for a single-column printed-report export (real-world gap, 2026-08-21)', async () => {
    const filePath = path.join(tmpDir, 'libro-iva-compras.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Original');
    // Real shape: company-info/header lines, then real data lines, then a
    // trailing Total row — all in a single column, no real headers at all.
    sheet.addRow(['         GRUPO ARIES SALUD SA']);
    sheet.addRow([
      '         Fecha       Comprobante                       Fecha       Sujeto                                CUIT           Con.   Referencia  Impuestos      Total          Neto             Exento          Neto            21%         10.5%          27%      Per. IIBB       Per. IVA                      Otros',
    ]);
    sheet.addRow([
      '         01/04/2026   0001-FCP-A-0001-00000320         11/12/2025  30, GAV SALUD S.A.               30-71590222-9      RI    -0001-0000021692      15.125.000,00              0,00              0,00  12.500.000,002.625.000,00        0,00          0,00             0,00            0,00                     0,00',
    ]);
    sheet.addRow([
      '         Total                                                                                                                                    242.479.278,08    194.624.087,01               0,00    39.453.079,498.230.023,45  10.920,00     42.792,73        35.592,70     82.625,34                   157,36',
    ]);
    await workbook.xlsx.writeFile(filePath);

    const rows = await collect(streamRowsFromFile(filePath, 'xlsx', 'libro_iva_compras'));
    expect(rows).toHaveLength(1);
    expect(rows[0].CUIT).toBe('30-71590222-9');
    expect(rows[0].__prefix).toBe('FCP');
    expect(rows[0]['Neto gravado']).toBe('12.500.000,00');
    expect(rows[0]['21%']).toBe('2.625.000,00');
  });

  it('a different sourceSystem still uses the generic header-row XLSX reader unchanged', async () => {
    const filePath = path.join(tmpDir, 'tango.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['CUIT', 'Tipo']);
    sheet.addRow(['30111111112', 'Factura A']);
    await workbook.xlsx.writeFile(filePath);

    const rows = await collect(streamRowsFromFile(filePath, 'xlsx', 'tango'));
    expect(rows).toEqual([{ CUIT: '30111111112', Tipo: 'Factura A' }]);
  });
});
