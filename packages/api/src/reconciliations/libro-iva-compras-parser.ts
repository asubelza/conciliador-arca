/**
 * libro-iva-compras-parser.ts — real-world gap found running the app
 * against the user's actual "Plataforma" contabilidad export
 * (`PLATAFORMA_COMPRAS.xlsx`, uploaded 2026-08-21): it is NOT a clean
 * tabular export at all. It's a single-column "printed report" dump of a
 * "Libro de IVA Compras" (VAT purchases ledger) — every worksheet row is
 * one pre-formatted text line, repeated per printed page with its own
 * company-info/header block and a final grand-total row. The generic
 * file-row-stream.ts XLSX reader (which treats worksheet row 1 as column
 * headers) cannot make sense of this at all, which is why ~99% of the
 * user's first real test run landed in "errors" (tipo unresolved, cuit
 * empty, importe 0) even though they selected "Tango" in the dropdown —
 * this format shares nothing with Tango's assumed clean-column export.
 *
 * This module identifies which lines are actual voucher rows (vs.
 * company-info, the two-line printed header, page-break markers, and the
 * trailing "Total" summary row) and extracts fields from them.
 *
 * Field extraction is regex-based, not fixed-column-offset slicing, on
 * purpose: this report right-aligns amount columns with no separator
 * between them once a value is wide enough to fill its column, e.g. a
 * confirmed real row where "Neto gravado" (12.500.000,00) and "21%"
 * (2.625.000,00) are directly concatenated with zero whitespace between
 * them ("...12.500.000,002.625.000,00..."). There is no single fixed
 * character offset that reliably separates them across all rows. Instead:
 * every amount column always matches the Argentine `#.###.###,##` shape,
 * so all ten trailing amounts are extracted with one regex, in their known
 * fixed left-to-right order, sidestepping the concatenation problem
 * entirely. The leading fields (dates, comprobante, CUIT) are unambiguous
 * and extracted the same way, in order.
 *
 * Header order (confirmed from the file's own two-line column header,
 * rows 11-12 of the sample): Fecha, Comprobante, Fecha Cpbte (IVA),
 * Sujeto, CUIT, Con., Referencia, then 10 amount columns: Impuestos
 * Total, Neto no gravado, Exento, Neto gravado, 21%, 10.5%, 27%,
 * Per. IIBB, Per. IVA, Otros conceptos.
 *
 * The comprobante's 4-letter-ish prefix (FCP/CCP in the sample) turns out
 * to carry real tipo information, not just be decorative: every one of
 * the 6 real "CCP" rows in the sample has a negative first amount, and
 * every one of the 225 "FCP" rows is positive — i.e. FCP = Factura de
 * Compra, CCP = (Nota de) Crédito de Compra. `__prefix` is exposed
 * alongside `__letra` so column-adapters.ts can resolve the true AFIP
 * tipo (Factura A/B/C vs NC A/B/C) instead of only ever resolving to a
 * Factura — see afip-tipo-lookup.ts's libro_iva_compras table.
 */
import type { RawRow } from './file-row-stream';

const DATE_RE = /\d{2}\/\d{2}\/\d{4}/g;
// sucursal(4)-prefijo(2-4 letras)-letra(1)-puntoVenta(4)-numero(8), e.g.
// "0001-FCP-A-0001-00000320". Confirmed prefixes in real data: FCP, CCP
// (both regular facturas de compra in the sample; no NC/ND example seen
// yet — see afip-tipo-lookup.ts's libro_iva_compras table).
const COMPROBANTE_RE = /(\d{4})-([A-Z]{2,4})-([A-Z])-(\d{4})-(\d{8})/;
const CUIT_RE = /\d{2}-\d{8}-\d/;
const AMOUNT_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

/** The 10 amount columns, in the fixed order they always appear (confirmed: every real data row in the sample has exactly 10). */
const AMOUNT_FIELDS = [
  'Impuestos Total',
  'Neto no gravado',
  'Exento',
  'Neto gravado',
  '21%',
  '10.5%',
  '27%',
  'Per. IIBB',
  'Per. IVA',
  'Otros conceptos',
] as const;

/**
 * A line is a real voucher row iff it has at least two dates and a CUIT —
 * both are absent from the company-info lines, the two header lines, the
 * page-break marker (`_x000C_`), and the trailing "Total" summary row
 * (confirmed: none of those non-data line types contain a CUIT-shaped
 * token). This is deliberately looser than also requiring
 * `COMPROBANTE_RE` to match, because four real rows in the sample
 * (bank-debit entries, comprobante "0001-DBI-3004000026") don't have the
 * usual sucursal-prefijo-letra-puntoVenta-numero shape at all — those
 * still need to come through as a row (their tipo_cbte will legitimately
 * resolve to undefined downstream, routing them to 'errors' per RF-06,
 * same as any other unrecognized tipo).
 */
function isVoucherLine(line: string): boolean {
  const dates = line.match(DATE_RE);
  return (dates?.length ?? 0) >= 2 && CUIT_RE.test(line);
}

/** Splits a matched comprobante like "0001-FCP-A-0001-00000320" into its AFIP-shaped parts. */
function splitComprobante(line: string): {
  prefix: string | undefined;
  letra: string | undefined;
  puntoVenta: string | undefined;
  numero: string | undefined;
} {
  const m = COMPROBANTE_RE.exec(line);
  if (!m) return { prefix: undefined, letra: undefined, puntoVenta: undefined, numero: undefined };
  const [, , prefix, letra, puntoVenta, numero] = m;
  return { prefix, letra, puntoVenta: String(Number(puntoVenta)), numero: String(Number(numero)) };
}

function extractSujeto(line: string, afterIndex: number, cuitIndex: number): string | undefined {
  const between = line.slice(afterIndex, cuitIndex).trim();
  return between === '' ? undefined : between;
}

function extractCon(line: string, afterCuitIndex: number): string | undefined {
  const m = /^\s*([A-Z]{1,3})\s/.exec(line.slice(afterCuitIndex));
  return m ? m[1] : undefined;
}

function extractReferencia(line: string, afterConIndex: number, firstAmountIndex: number): string | undefined {
  const between = line.slice(afterConIndex, firstAmountIndex).trim();
  return between === '' ? undefined : between;
}

/**
 * Parses one voucher line into a RawRow keyed by the report's own column
 * labels, ready for `adaptLibroIvaCompras` (column-adapters.ts) — mirrors
 * the existing convention (e.g. Bejerman's combined "Nro.Comp." column)
 * of keeping this module's job to relocating/splitting values, not
 * parsing dates/amounts/CUIT punctuation (comprobante-normalizer.ts's job).
 */
function parseVoucherLine(line: string): RawRow {
  const dates = [...line.matchAll(DATE_RE)];
  const firstDate = dates[0]?.[0];
  const secondDate = dates[1]?.[0];

  const cbteMatch = COMPROBANTE_RE.exec(line);
  const { prefix, letra, puntoVenta, numero } = splitComprobante(line);

  const cuitMatch = CUIT_RE.exec(line);

  const sujetoStart = cbteMatch ? cbteMatch.index + cbteMatch[0].length : (dates[0]?.index ?? 0) + 10;
  // Sujeto sits between the second date and CUIT.
  const secondDateEnd = dates[1] ? dates[1].index! + dates[1][0].length : sujetoStart;
  const cuitStart = cuitMatch ? cuitMatch.index : line.length;
  const sujeto = extractSujeto(line, secondDateEnd, cuitStart);

  const afterCuit = cuitMatch ? cuitMatch.index + cuitMatch[0].length : line.length;
  const con = extractCon(line, afterCuit);

  const amounts = [...line.matchAll(AMOUNT_RE)];
  const firstAmountIndex = amounts[0]?.index ?? line.length;
  const afterCon = con ? line.indexOf(con, afterCuit) + con.length : afterCuit;
  const referencia = extractReferencia(line, afterCon, firstAmountIndex);

  const row: RawRow = {
    Fecha: firstDate,
    Comprobante: cbteMatch?.[0],
    'Fecha Cpbte': secondDate,
    Sujeto: sujeto,
    CUIT: cuitMatch?.[0],
    'Con.': con,
    Referencia: referencia,
    __prefix: prefix,
    __letra: letra,
    __punto_venta: puntoVenta,
    __numero: numero,
  };

  AMOUNT_FIELDS.forEach((field, i) => {
    row[field] = amounts[i]?.[0];
  });

  return row;
}

/**
 * Parses the raw single-column lines of a "Libro de IVA Compras" printed
 * report export into RawRow objects — one per real voucher line.
 * Company-info, the printed header, page-break markers and the trailing
 * "Total" summary row are all silently skipped (they aren't voucher data).
 */
export function parseLibroIvaComprasLines(lines: (string | null | undefined)[]): RawRow[] {
  const rows: RawRow[] = [];
  for (const raw of lines) {
    if (raw === null || raw === undefined) continue;
    const line = String(raw);
    if (!isVoucherLine(line)) continue;
    rows.push(parseVoucherLine(line));
  }
  return rows;
}
