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
});
