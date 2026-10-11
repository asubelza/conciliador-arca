/**
 * afip-tipo-lookup.ts — T07 (RF-06): resolves a vendor-specific tipo value
 * (numeric AFIP code, or a source system's own text label/shorthand) to the
 * canonical AFIP comprobante-tipo integer used by `CanonicalVoucher.tipo_cbte`
 * (packages/shared-types).
 *
 * Real AFIP tipo codes (the actual "Tabla de Comprobantes" used by ARCA,
 * not an internal invention): 1=Factura A, 2=ND A, 3=NC A, 6=Factura B,
 * 7=ND B, 8=NC B, 11=Factura C, 12=ND C, 13=NC C, 15=Recibo C, 19=Factura E,
 * 20=ND E, 21=NC E, 51=Factura A con leyenda "Operación Sujeta a Retención"
 * (RG 5762/2025 repurposed this code away from its old "Factura M" meaning
 * — see shared-types' AFIP_TIPOS_CADENCIAL doc comment), 81=Tique-Factura A.
 * ARCA's own export already carries these as numeric codes (see
 * comprobante-normalization.spec.md's ARCA scenario: `"1" -> 1`), so ARCA
 * rows resolve via straight numeric parse. Each contabilidad system has its
 * own shorthand vocabulary for the same codes (Tango spells out "Factura A";
 * Bejerman uses terse `S/Tc` codes like "FCC"; Xubio abbreviates to "NC");
 * those are captured per-source below, matching the concrete examples in
 * comprobante-normalization.spec.md's RF-05 scenarios.
 *
 * An unrecognized tipo (numeric or textual) resolves to `undefined` — RF-06
 * requires that to flow into `classification = 'errors'`, not a crash or a
 * silently-wrong default (see comprobante-normalizer.ts).
 *
 * `KNOWN_AFIP_CODES` is sourced from shared-types' `AFIP_TIPOS_CADENCIAL`
 * (not a locally duplicated list) since 2026-08-22's conciliacion-periodica
 * work (RF-14) — see that package's module doc for why: `vouchers_canonical`
 * used to carry a completely different, disconnected tipo encoding, and the
 * fix was to make this the single source of truth both sides import.
 */
import { AFIP_TIPOS_CADENCIAL } from 'shared-types';
import type { SourceSystem } from './column-adapters';

/** Numeric AFIP tipo codes this catalogue recognizes (real AFIP codes). */
const KNOWN_AFIP_CODES = new Set<number>(AFIP_TIPOS_CADENCIAL);

/**
 * Per-source text/shorthand -> canonical AFIP integer. Keys are matched
 * case-insensitively after trimming. Only the aliases confirmed by real
 * sample data or by comprobante-normalization.spec.md's scenarios are
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
    // `S/Tc = "FCC"` canonicalizes to 3.
    fca: 1,
    fcb: 6,
    fcc: 3,
    ndc: 2,
    ncc: 3,
  },
  xubio: {
    // Confirmed by comprobante-normalization.spec.md's Xubio scenario:
    // `tipo = "NC"` canonicalizes to 3 (NC A).
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
  libro_iva_compras: {
    // Confirmed from a real "Libro de IVA Compras" export (2026-08-21):
    // comprobantes are like "0001-FCP-A-0001-00000320" — sucursal, a
    // 3-letter prefix, then the AFIP letra. Keys here are
    // "<prefix> <letra>" (lowercased), built by column-adapters.ts's
    // adaptLibroIvaCompras from `__prefix`/`__letra`
    // (libro-iva-compras-parser.ts). Only "FCP" and "CCP" appear in the
    // sample, and every single FCP row has a positive first amount while
    // every single CCP row is negative (225 vs 6 rows, no exceptions) —
    // i.e. FCP = Factura de Compra, CCP = Nota de Crédito de compra. No
    // Nota de Débito example exists yet to confirm its own prefix.
    'fcp a': 1,
    'fcp b': 6,
    'fcp c': 11,
    'ccp a': 3,
    'ccp b': 8,
    'ccp c': 13,
  },
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolves a raw tipo value from `source` to the canonical AFIP integer, or
 * `undefined` if it isn't recognized (RF-06 "unknown tipo" path).
 */
export function lookupAfipTipo(source: SourceSystem, rawValue: unknown): number | undefined {
  if (rawValue === null || rawValue === undefined) return undefined;

  const asString = String(rawValue).trim();
  if (asString === '') return undefined;

  // Numeric codes are accepted from any source (ARCA always sends them
  // this way; a contabilidad export that happens to already use the AFIP
  // integer directly should not be forced through the text-alias table).
  if (/^\d+$/.test(asString)) {
    const numeric = Number(asString);
    return KNOWN_AFIP_CODES.has(numeric) ? numeric : undefined;
  }

  if (source === 'arca') return undefined; // ARCA is numeric-only per RF-05

  const aliases = TEXT_ALIASES[source];
  return aliases[normalizeKey(asString)];
}
