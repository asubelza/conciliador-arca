/**
 * afip-tipo-lookup.ts — T07 (RF-06): resolves a vendor-specific tipo value
 * (numeric AFIP code, or a source system's own text label/shorthand) to the
 * canonical AFIP comprobante-tipo CODE used by `CanonicalVoucher.tipo_cbte`
 * (packages/shared-types): a zero-padded 3-digit STRING (`AfipTipo`, e.g.
 * `"001"`), one of the 15 codes in `AFIP_TIPOS_CADENCIAL`.
 *
 * FIX (BLOCKER, PR review finding #2): this module used to invent its own
 * parallel catalogue of plain integers (1, 2, 3, 6, 7, 8, 11, 12, 13, 19,
 * 20, 21 — the real-world AFIP "Tabla de Comprobantes" numeric codes,
 * fully split by letter A/B/C/E) and resolved to one of those integers.
 * That is NOT what `CanonicalVoucher.tipo_cbte` actually is — the DB's
 * `afip_tipo_map` table (packages/api/prisma/migrations/
 * 002_init_afip_tipo_map.sql) stores `tipo CHAR(3)`, seeded 1:1 from
 * shared-types' `AFIP_TIPOS_CADENCIAL`/`AFIP_TIPO_LABELS` (see
 * packages/api/src/seed.ts), and `vouchers_canonical.tipo` FK-references
 * that same CHAR(3) column. So the real canonical catalogue is the
 * zero-padded string codes already defined in shared-types, not an
 * integer this module made up.
 *
 * Design decision: shared-types' 15-code catalogue does NOT split every
 * comprobante family by letter the way the real AFIP table does — there is
 * one generic `NOTA_DE_CREDITO` ('005') and one generic `NOTA_DE_DEBITO`
 * ('006') regardless of A/B/C, with only Factura and the export variants
 * getting their own codes (`001`/`003`/`004` for Factura A/B/C, `007`/`008`
 * for export Facturas, `011`/`014` for export NC/ND). Rather than inventing
 * new canonical codes (which would require a migration + reseed + touching
 * every other consumer of the 15-code catalogue), this module keeps its
 * real-world numeric/text vendor knowledge exactly as before (still needed
 * to interpret each source's actual export format) and adds one extra step
 * at the end: map the resolved real-world AFIP code onto the closest
 * shared-types canonical code via `REAL_CODE_TO_CANONICAL`. This preserves
 * the NC/ND distinction (which drives the sign-flip in
 * comprobante-normalizer.ts) while accepting that the letter (A/B/C) is
 * lost for NC/ND — the same loss of granularity the DB schema itself
 * already committed to by seeding only 15 rows.
 *
 * An unrecognized tipo (numeric or textual) resolves to `undefined` — RF-06
 * requires that to flow into `classification = 'errors'`, not a crash or a
 * silently-wrong default (see comprobante-normalizer.ts).
 */
import type { AfipTipo } from 'shared-types';
import type { SourceSystem } from './column-adapters';

/**
 * Real-world AFIP "Tabla de Comprobantes" numeric codes this catalogue
 * recognizes, mapped onto the closest canonical shared-types code:
 * 1=Factura A, 2=ND A, 3=NC A, 6=Factura B, 7=ND B, 8=NC B, 11=Factura C,
 * 12=ND C, 13=NC C, 19=Factura E, 20=ND E, 21=NC E. ARCA's own export
 * already carries these as numeric codes (see
 * comprobante-normalization.spec.md's ARCA scenario: `"1" -> "001"`), so
 * ARCA rows resolve via straight numeric parse through this table too.
 */
const REAL_CODE_TO_CANONICAL: Record<number, AfipTipo> = {
  1: '001', // Factura A -> FACTURA
  6: '003', // Factura B -> FACTURA_B
  11: '004', // Factura C -> FACTURA_C
  19: '007', // Factura E -> FACTURA_EXPORTACION
  2: '006', // ND A -> NOTA_DE_DEBITO (no A/B/C split in the canonical catalogue)
  7: '006', // ND B -> NOTA_DE_DEBITO
  12: '006', // ND C -> NOTA_DE_DEBITO
  20: '014', // ND E -> NOTA_DEBITO_EXPORTACION
  3: '005', // NC A -> NOTA_DE_CREDITO (no A/B/C split in the canonical catalogue)
  8: '005', // NC B -> NOTA_DE_CREDITO
  13: '005', // NC C -> NOTA_DE_CREDITO
  21: '011', // NC E -> NOTA_CREDITO_EXPORTACION
};

/**
 * Per-source text/shorthand -> real-world AFIP numeric code (see
 * `REAL_CODE_TO_CANONICAL` above for the final canonical mapping). Keys are
 * matched case-insensitively after trimming. Only the aliases confirmed by
 * real sample data or by comprobante-normalization.spec.md's scenarios are
 * included; an operator can extend these tables (RF-06's "tipo drift"
 * scenario) without touching the matching/classification engine.
 */
const TEXT_ALIASES: Record<Exclude<SourceSystem, 'arca'>, Record<string, number>> = {
  tango: {
    'factura a': 1,
    'nd a': 2,
    'nota de debito a': 2,
    'nota de débito a': 2,
    'nc a': 3,
    'nota de credito a': 3,
    'nota de crédito a': 3,
    'factura b': 6,
    'nd b': 7,
    'nc b': 8,
    'factura c': 11,
    'nd c': 12,
    'nc c': 13,
  },
  bejerman: {
    // Bejerman's own `S/Tc` shorthand (terse, not AFIP's own letters).
    // Confirmed by comprobante-normalization.spec.md's Bejerman scenario:
    // `S/Tc = "FCC"` canonicalizes to NC (real code 3 -> canonical '005').
    fca: 1,
    fcb: 6,
    fcc: 3,
    ndc: 2,
    ncc: 3,
  },
  xubio: {
    // Confirmed by comprobante-normalization.spec.md's Xubio scenario:
    // `tipo = "NC"` canonicalizes to NC (real code 3 -> canonical '005').
    fa: 1,
    fb: 6,
    fc: 11,
    nc: 3,
    nd: 2,
  },
  contabilium: {
    // No concrete Contabilium scenario in the spec yet (see
    // openspec/proposal — real sample files are still pending from the
    // user, per the estado_dev doc's outstanding request). Modeled
    // analogously to Tango's full-word convention until a real export is
    // available to confirm.
    'factura a': 1,
    'factura b': 6,
    'factura c': 11,
    'nota de credito a': 3,
    'nota de credito b': 8,
    'nota de credito c': 13,
  },
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolves a raw tipo value from `source` to the canonical `AfipTipo`
 * (zero-padded 3-digit string), or `undefined` if it isn't recognized
 * (RF-06 "unknown tipo" path).
 */
export function lookupAfipTipo(source: SourceSystem, rawValue: unknown): AfipTipo | undefined {
  if (rawValue === null || rawValue === undefined) return undefined;

  const asString = String(rawValue).trim();
  if (asString === '') return undefined;

  // Numeric codes are accepted from any source (ARCA always sends them
  // this way; a contabilidad export that happens to already use the AFIP
  // integer directly should not be forced through the text-alias table).
  if (/^\d+$/.test(asString)) {
    const numeric = Number(asString);
    return REAL_CODE_TO_CANONICAL[numeric];
  }

  if (source === 'arca') return undefined; // ARCA is numeric-only per RF-05

  const aliases = TEXT_ALIASES[source];
  const realCode = aliases[normalizeKey(asString)];
  return realCode === undefined ? undefined : REAL_CODE_TO_CANONICAL[realCode];
}
