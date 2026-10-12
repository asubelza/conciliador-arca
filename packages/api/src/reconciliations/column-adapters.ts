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
 * RF-05 scenarios where a scenario exists (ARCA's `Nro. Doc. Emisor` —
 * corrected 2026-08-23 against a real "Comprobantes Recibidos" export, see
 * `adaptArca`'s own doc — Tango's `CUIT`/`Tipo`, Bejerman's
 * `S/Tc`/`Nro.Comp.`, Xubio's `tipo`/`importe`). Fields with no scenario
 * yet (punto_venta/numero/fecha for Tango/Xubio, all of Contabilium) use a
 * best-guess column name, explicitly called out below — see estado_dev
 * doc's outstanding request for real sample exports to confirm or correct
 * these.
 */
import { lookupAfipTipo } from './afip-tipo-lookup';
import type { RawRow } from './file-row-stream';
import type { AfipTipo } from 'shared-types';

export type SourceSystem = 'arca' | 'tango' | 'bejerman' | 'xubio' | 'contabilium' | 'libro_iva_compras';

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

/**
 * Repairs a real export-tool artifact confirmed 2026-08-23 on a genuine
 * ARCA "Comprobantes Recibidos" consulta export: its headers arrive as
 * UTF-8 bytes that got decoded as Latin-1/Windows-1252 somewhere in the
 * file's own export pipeline, before it ever reaches us — every accented
 * header comes through mangled ("Fecha de EmisiÃ³n" instead of "Fecha de
 * Emisión", "NÃºmero Desde" instead of "Número Desde"). The corruption is
 * already baked into the file's own stored text (confirmed reading the raw
 * .xlsx), not something our own CSV/XLSX parsing does — so it has to be
 * repaired here rather than fixed by reading the file differently.
 *
 * Detected by trying the reverse transcode and checking it actually
 * removed the tell-tale "Ã<byte>" sequence without introducing the U+FFFD
 * replacement character — that would mean the string wasn't actually
 * double-encoded, and "fixing" it would corrupt it further.
 */
function repairMojibake(value: string): string {
  if (!/Ã[\x80-\xBF]/.test(value)) return value;
  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  return repaired.includes('�') ? value : repaired;
}

/** Applies `repairMojibake` to a row's own column names, only when at least one needs it (cheap no-op for every clean file). */
function repairRowHeaders(row: RawRow): RawRow {
  const keys = Object.keys(row);
  if (!keys.some((k) => /Ã[\x80-\xBF]/.test(k))) return row;
  const repaired: RawRow = {};
  for (const key of keys) {
    repaired[repairMojibake(key)] = row[key];
  }
  return repaired;
}

/**
 * Real ARCA exports (confirmed 2026-08-23) spell `Tipo de Comprobante` as
 * `"<código AFIP> - <descripción>"` (e.g. `"1 - Factura A"`), not a bare
 * number. `lookupAfipTipo`'s ARCA path only accepts a pure-numeric string
 * (RF-05: "ARCA is numeric-only") — deliberately, so it never falls
 * through to the contabilidad text-alias tables. This strips the
 * description before that check, leaving an already-bare numeric value
 * (the synthetic scenario in comprobante-normalization.spec.md, and any
 * export that already sends a bare code) untouched.
 */
function extractLeadingAfipCode(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const match = raw.match(/^\s*(\d+)\s*-/);
  return match ? match[1] : raw;
}

function adaptArca(rawRow: RawRow): AdaptedRow {
  const row = repairRowHeaders(rawRow);
  const tipoRaw = extractLeadingAfipCode(firstPresent(row, ['Tipo de Comprobante', 'tipo_cbte', 'Tipo']));
  return {
    // ARCA's "Comprobantes Recibidos" export names columns from the
    // exporting party's own point of view: "Emisor" is whoever issued the
    // comprobante (the vendor — what this system needs for cuit_emisor),
    // "Receptor" is whoever received it (the estudio's own client, i.e.
    // the SAME value on every row of the file — confirmed 2026-08-23 on a
    // real 995-row export: single Receptor CUIT, 292 distinct Emisor
    // CUITs). Correcting comprobante-normalization.spec.md's RF-05
    // scenario, which had these backwards (an assumption never checked
    // against a real export until now).
    cuit_emisor_raw: asString(firstPresent(row, ['Nro. Doc. Emisor', 'CUIT'])),
    tipo_cbte: lookupAfipTipo('arca', tipoRaw),
    punto_venta_raw: asString(firstPresent(row, ['Punto de Venta', 'Pto. Vta.'])),
    // "Número Desde"/"Número Hasta" is this export's own column pair (a
    // range, for a single comprobante Desde === Hasta) — real ARCA sample,
    // 2026-08-23.
    numero_raw: asString(
      firstPresent(row, ['Número de Comprobante', 'Numero de Comprobante', 'Número', 'Número Desde', 'Numero Desde']),
    ),
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

/**
 * "libro_iva_compras" — real sample-driven adapter added 2026-08-21 (see
 * libro-iva-compras-parser.ts's module doc for the full story). Unlike the
 * other adapters, its RawRow isn't a vendor's own column names — it's
 * produced by libro-iva-compras-parser.ts from a fixed-width printed
 * report, which already splits the "Comprobante" field into
 * `__letra`/`__punto_venta`/`__numero` (same "split the combined field
 * here, not in the parser" division of labor as Bejerman's
 * splitPuntoVentaNumero above). `fecha_emision_raw` uses the SECOND date
 * on the line ("Fecha Cpbte", the comprobante's own date) rather than the
 * first ("Fecha", confirmed to be the accounting/registration date — real
 * sample row: Fecha=01/04/2026 but Fecha Cpbte=11/12/2025, a much older
 * invoice entered late) since ARCA's own "Fecha de Emisión" is the
 * comprobante's issue date, not when it was booked.
 *
 * `tipo_cbte` is resolved from `__prefix` + `__letra` together (e.g.
 * "FCP A", "CCP C"), not letra alone — confirmed from real data that the
 * prefix distinguishes Factura (FCP, always positive amounts in the
 * sample) from Nota de Crédito (CCP, always negative), regardless of
 * letra, so a bare letra can't tell a Factura C from a NC C.
 */
function adaptLibroIvaCompras(row: RawRow): AdaptedRow {
  const prefix = asString(firstPresent(row, ['__prefix']));
  const letra = asString(firstPresent(row, ['__letra']));
  const tipoRaw = prefix && letra ? `${prefix} ${letra}` : undefined;
  return {
    cuit_emisor_raw: asString(firstPresent(row, ['CUIT'])),
    tipo_cbte: lookupAfipTipo('libro_iva_compras', tipoRaw),
    punto_venta_raw: asString(firstPresent(row, ['__punto_venta'])),
    numero_raw: asString(firstPresent(row, ['__numero'])),
    fecha_emision_raw: asString(firstPresent(row, ['Fecha Cpbte'])),
    importe_total_raw: asString(firstPresent(row, ['Impuestos Total'])),
    source_row: row,
  };
}

const ADAPTERS: Record<SourceSystem, (row: RawRow) => AdaptedRow> = {
  arca: adaptArca,
  tango: adaptTango,
  bejerman: adaptBejerman,
  xubio: adaptXubio,
  contabilium: adaptContabilium,
  libro_iva_compras: adaptLibroIvaCompras,
};

export function adaptRow(source: SourceSystem, row: RawRow): AdaptedRow {
  return ADAPTERS[source](row);
}
