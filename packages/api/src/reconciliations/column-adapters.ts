/**
 * column-adapters.ts — T07 (RF-05): maps each source system's raw,
 * vendor-specific column names to an intermediate row keyed by canonical
 * field name. Adapters are config-driven (a column-name list per field)
 * rather than one bespoke function per source, so adding a new source or a
 * new column alias (an export format changing slightly) doesn't touch the
 * matching/classification engine — per architecture.md's "extensible
 * parsers" testing note and RF-05's acceptance criterion #1.
 *
 * This module only relocates values under their canonical field name — it
 * does NOT parse them (comma-decimals, dates, CUIT punctuation, NC/ND sign
 * are comprobante-normalizer.ts's job, T08). `tipo_cbte` is the one field
 * resolved here rather than deferred, since resolving it requires knowing
 * which source's alias table to consult (afip-tipo-lookup.ts).
 *
 * Column names below are confirmed by comprobante-normalization.spec.md's
 * RF-05 scenarios where a scenario exists (ARCA's `Nro. Doc. Receptor`,
 * Tango's `CUIT`/`Tipo`, Bejerman's `S/Tc`/`Nro.Comp.`, Xubio's
 * `tipo`/`importe`). Fields with no scenario yet (punto_venta/numero/fecha
 * for Tango/Xubio, all of Contabilium) use a best-guess column name,
 * explicitly called out below — see estado_dev doc's outstanding request
 * for real sample exports to confirm or correct these.
 */
import { lookupAfipTipo } from './afip-tipo-lookup';
import type { RawRow } from './file-row-stream';
import type { AfipTipo } from 'shared-types';

export type SourceSystem = 'arca' | 'tango' | 'bejerman' | 'xubio' | 'contabilium';

export interface AdaptedRow {
  cuit_emisor_raw: string | undefined;
  tipo_cbte: AfipTipo | undefined;
  punto_venta_raw: string | undefined;
  numero_raw: string | undefined;
  fecha_emision_raw: string | undefined;
  importe_total_raw: string | undefined;
  source_row: RawRow;
}

function firstPresent(row: RawRow, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

/** Splits Bejerman's combined `"0001-00001234"` into [puntoVenta, numero]. */
function splitPuntoVentaNumero(combined: string | undefined): [string | undefined, string | undefined] {
  if (!combined) return [undefined, undefined];
  const match = combined.match(/^(\d+)-(\d+)$/);
  if (!match) return [undefined, undefined];
  return [String(Number(match[1])), String(Number(match[2]))];
}

function adaptArca(row: RawRow): AdaptedRow {
  const tipoRaw = firstPresent(row, ['Tipo de Comprobante', 'tipo_cbte', 'Tipo']);
  return {
    cuit_emisor_raw: asString(firstPresent(row, ['Nro. Doc. Receptor', 'CUIT'])),
    tipo_cbte: lookupAfipTipo('arca', tipoRaw),
    punto_venta_raw: asString(firstPresent(row, ['Punto de Venta', 'Pto. Vta.'])),
    numero_raw: asString(firstPresent(row, ['Número de Comprobante', 'Numero de Comprobante', 'Número'])),
    fecha_emision_raw: asString(firstPresent(row, ['Fecha de Emisión', 'Fecha de Emision'])),
    importe_total_raw: asString(firstPresent(row, ['Imp. Total', 'Importe Total'])),
    source_row: row,
  };
}

function adaptTango(row: RawRow): AdaptedRow {
  const tipoRaw = firstPresent(row, ['Tipo']);
  return {
    cuit_emisor_raw: asString(firstPresent(row, ['CUIT'])),
    tipo_cbte: lookupAfipTipo('tango', tipoRaw),
    // No RF-05 scenario for these two yet — best guess, see module doc.
    punto_venta_raw: asString(firstPresent(row, ['Punto de Venta', 'Pto Vta'])),
    numero_raw: asString(firstPresent(row, ['Número', 'Numero'])),
    fecha_emision_raw: asString(firstPresent(row, ['Fecha'])),
    importe_total_raw: asString(firstPresent(row, ['Importe', 'Total'])),
    source_row: row,
  };
}

function adaptBejerman(row: RawRow): AdaptedRow {
  const tipoRaw = firstPresent(row, ['S/Tc']);
  const [puntoVenta, numero] = splitPuntoVentaNumero(asString(firstPresent(row, ['Nro.Comp.', 'Nro. Comp.'])));
  return {
    cuit_emisor_raw: asString(firstPresent(row, ['CUIT'])),
    tipo_cbte: lookupAfipTipo('bejerman', tipoRaw),
    punto_venta_raw: puntoVenta,
    numero_raw: numero,
    fecha_emision_raw: asString(firstPresent(row, ['Fecha'])),
    // No RF-05 scenario naming Bejerman's amount column — best guess.
    importe_total_raw: asString(firstPresent(row, ['Imp. Total', 'Importe'])),
    source_row: row,
  };
}

function adaptXubio(row: RawRow): AdaptedRow {
  const tipoRaw = firstPresent(row, ['tipo']);
  return {
    cuit_emisor_raw: asString(firstPresent(row, ['cuit'])),
    tipo_cbte: lookupAfipTipo('xubio', tipoRaw),
    // No RF-05 scenario for these three yet — best guess, see module doc.
    punto_venta_raw: asString(firstPresent(row, ['puntoVenta', 'punto_venta'])),
    numero_raw: asString(firstPresent(row, ['numero'])),
    fecha_emision_raw: asString(firstPresent(row, ['fecha'])),
    importe_total_raw: asString(firstPresent(row, ['importe'])),
    source_row: row,
  };
}

function adaptContabilium(row: RawRow): AdaptedRow {
  // No RF-05 scenario for Contabilium at all yet — modeled analogously to
  // Tango's full-word column convention, pending a real sample export.
  const tipoRaw = firstPresent(row, ['Tipo Comprobante', 'Tipo']);
  return {
    cuit_emisor_raw: asString(firstPresent(row, ['CUIT'])),
    tipo_cbte: lookupAfipTipo('contabilium', tipoRaw),
    punto_venta_raw: asString(firstPresent(row, ['Punto de Venta'])),
    numero_raw: asString(firstPresent(row, ['Numero Comprobante', 'Número'])),
    fecha_emision_raw: asString(firstPresent(row, ['Fecha Emision', 'Fecha'])),
    importe_total_raw: asString(firstPresent(row, ['Total'])),
    source_row: row,
  };
}

const ADAPTERS: Record<SourceSystem, (row: RawRow) => AdaptedRow> = {
  arca: adaptArca,
  tango: adaptTango,
  bejerman: adaptBejerman,
  xubio: adaptXubio,
  contabilium: adaptContabilium,
};

export function adaptRow(source: SourceSystem, row: RawRow): AdaptedRow {
  return ADAPTERS[source](row);
}
