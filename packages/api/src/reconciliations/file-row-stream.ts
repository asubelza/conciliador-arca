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
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { AllowedExtension } from './upload-validation';

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

export function streamRowsFromFile(
  filePath: string,
  extension: AllowedExtension,
): AsyncGenerator<RawRow> {
  if (extension === 'csv') return streamCsvRows(filePath);
  if (extension === 'xlsx') return streamXlsxRows(filePath);
  return streamXlsRows(filePath);
}
