/**
 * file-row-stream.ts — T05 (RF-03): turns an uploaded CSV/XLSX/XLS file on
 * disk into an async stream of raw header-keyed row objects, ready to hand
 * to staging-writer.ts for COPY FROM STDIN.
 *
 * CSV and XLSX are read via true streaming parsers (csv-parse, exceljs
 * WorkbookReader) so a 50MB file is never held whole in memory — this is
 * what RF-03's "no whole-file buffer in memory" acceptance criterion is
 * actually about (see architecture.md: XLS parsing must not run in the
 * memory-capped Vercel function, only here in the worker).
 *
 * Deviation: legacy binary `.xls` has no practical streaming parser in the
 * Node ecosystem (SheetJS/`xlsx` reads the whole workbook into memory by
 * design). `.xls` is supported via `xlsx` for correctness, with the
 * known limitation that it is fully buffered — acceptable because `.xls`
 * exports are the least common of the three accepted extensions and this
 * is called out explicitly rather than silently degrading the RF-03
 * guarantee for the two formats that do stream.
 */
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { AllowedExtension } from './upload-validation';
import { parseLibroIvaComprasLines } from './libro-iva-compras-parser';

export type RawRow = Record<string, unknown>;

async function* streamCsvRows(filePath: string): AsyncGenerator<RawRow> {
  const parser = createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
  );
  for await (const record of parser as AsyncIterable<RawRow>) {
    yield record;
  }
}

async function* streamXlsxRows(filePath: string): AsyncGenerator<RawRow> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});
  for await (const worksheetReader of workbookReader) {
    let headers: string[] | undefined;
    for await (const row of worksheetReader) {
      // exceljs row.values is 1-indexed (index 0 is always undefined).
      const values = (row.values as unknown[]).slice(1);
      if (!headers) {
        headers = values.map((v) => String(v ?? '').trim());
        continue;
      }
      const isEmpty = values.every((v) => v === null || v === undefined || v === '');
      if (isEmpty) continue;
      const record: RawRow = {};
      headers.forEach((h, i) => {
        if (h) record[h] = values[i];
      });
      yield record;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function* streamXlsRows(filePath: string): AsyncGenerator<RawRow> {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: true });
  for (const row of rows) {
    yield row;
  }
}

/**
 * "libro_iva_compras" is not a clean tabular export (see
 * libro-iva-compras-parser.ts's module doc) — it's a single-column
 * printed-report dump, one raw text line per worksheet/file row, with no
 * real column headers at all. The generic per-extension readers above
 * (which all assume row 1 = headers, row N = a record with one value per
 * column) cannot make sense of that, so this source system bypasses them
 * entirely regardless of extension: every line of the underlying file
 * (whichever container it arrived in) is read as plain text and handed to
 * the dedicated line parser, which itself decides which lines are real
 * voucher rows.
 */
async function* streamLibroIvaComprasLinesFromXlsx(filePath: string): AsyncGenerator<string | null> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});
  for await (const worksheetReader of workbookReader) {
    for await (const row of worksheetReader) {
      const values = (row.values as unknown[]).slice(1);
      const first = values[0];
      yield first === undefined || first === null ? null : String(first);
    }
  }
}

async function* streamLibroIvaComprasLinesFromText(filePath: string): AsyncGenerator<string | null> {
  const rl = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function* streamLibroIvaComprasLinesFromLegacyXls(filePath: string): AsyncGenerator<string | null> {
  // exceljs's streaming reader only understands xlsx — legacy binary .xls
  // needs the buffered `xlsx` (SheetJS) reader instead, same as
  // streamXlsRows above. header: 1 returns arrays (no header inference),
  // matching how streamLibroIvaComprasLinesFromXlsx reads column A as-is.
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  for (const row of rows) {
    const first = row[0];
    yield first === undefined || first === null ? null : String(first);
  }
}

async function* streamLibroIvaComprasRows(
  filePath: string,
  extension: AllowedExtension,
): AsyncGenerator<RawRow> {
  const lines: (string | null)[] = [];
  let lineSource: AsyncGenerator<string | null>;
  if (extension === 'csv') {
    lineSource = streamLibroIvaComprasLinesFromText(filePath);
  } else if (extension === 'xlsx') {
    lineSource = streamLibroIvaComprasLinesFromXlsx(filePath);
  } else {
    lineSource = streamLibroIvaComprasLinesFromLegacyXls(filePath);
  }
  for await (const line of lineSource) {
    lines.push(line);
  }
  for (const row of parseLibroIvaComprasLines(lines)) {
    yield row;
  }
}

export function streamRowsFromFile(
  filePath: string,
  extension: AllowedExtension,
  sourceSystem?: string,
): AsyncGenerator<RawRow> {
  if (sourceSystem === 'libro_iva_compras') return streamLibroIvaComprasRows(filePath, extension);
  if (extension === 'csv') return streamCsvRows(filePath);
  if (extension === 'xlsx') return streamXlsxRows(filePath);
  return streamXlsRows(filePath);
}
