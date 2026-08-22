/**
 * shared-types — canonical data contracts for conciliador-arca.
 *
 * This package is the single source of truth for the AFIP comprobante tipo
 * catalogue and the canonical voucher reconciliation DTOs shared across the
 * API, web frontend, and seed pipeline.
 */

/**
 * Real AFIP "Tabla de Comprobantes" integer code, e.g. `1` (Factura A).
 *
 * Until 2026-08-22 this package exported a DIFFERENT, unrelated zero-padded
 * 3-digit scheme ('001', '003', ...) that was never actually wired to any
 * real adapter/normalizer — see conciliacion-periodica's
 * stock-historico-comprobantes.spec.md (RF-14) for the full story. This is
 * now the single source of truth for the codes every real code path
 * (column-adapters.ts, afip-tipo-lookup.ts, comprobante-normalizer.ts) has
 * always actually used via `CanonicalVoucher.tipo_cbte: number`.
 */
export type AfipTipo = number;

/**
 * The AFIP tipos this catalogue recognizes — the same set
 * `afip-tipo-lookup.ts`'s `KNOWN_AFIP_CODES` resolves to a canonical
 * `tipo_cbte`, imported from here rather than duplicated, so the two can
 * never drift apart again. Kept as a readonly tuple so consumers cannot
 * import an unknown tipo at runtime.
 */
export const AFIP_TIPOS_CADENCIAL: AfipTipo[] = [
  1, 2, 3, 6, 7, 8, 11, 12, 13, 19, 20, 21,
];

/** Human-readable label keyed by the real AFIP tipo integer code. */
export const AFIP_TIPO_LABELS: Record<AfipTipo, string> = {
  1: 'FACTURA_A',
  2: 'NOTA_DEBITO_A',
  3: 'NOTA_CREDITO_A',
  6: 'FACTURA_B',
  7: 'NOTA_DEBITO_B',
  8: 'NOTA_CREDITO_B',
  11: 'FACTURA_C',
  12: 'NOTA_DEBITO_C',
  13: 'NOTA_CREDITO_C',
  19: 'FACTURA_E',
  20: 'NOTA_DEBITO_E',
  21: 'NOTA_CREDITO_E',
};

/** Enum-like lookup mirroring AFIP_TIPO_LABELS (code -> label). */
export const ComprobanteTipo = AFIP_TIPO_LABELS;

/** Type guard: true only for the recognized real AFIP tipo codes. */
export function isValidAfipTipo(value: number): value is AfipTipo {
  return AFIP_TIPOS_CADENCIAL.includes(value);
}

/**
 * Branded tenant identifier. Construct via `cuid as TenantId` or a factory in
 * the tenant module; the brand prevents accidental mixing with bare strings.
 */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** Classification of a voucher after the matching engine runs (RF-09). */
export const Classification = {
  Matched: 'matched',
  UnmatchedArca: 'unmatched-arca',
  UnmatchedContabilidad: 'unmatched-contabilidad',
  Duplicates: 'duplicates',
  Errors: 'errors',
} as const;

export type Classification = (typeof Classification)[keyof typeof Classification];

/** A raw, unparsed voucher row as read from a source export (jsonb). */
export interface VoucherRow {
  [key: string]: unknown;
}

/** One staged raw row prior to normalization. */
export interface VoucherStagingRow {
  id: string;
  tenant_id: TenantId;
  raw_data: VoucherRow;
  created_at: Date;
}

/**
 * Canonical, normalized comprobante (ARCA composite key + ARS amount).
 * Matches the canonical tuple from comprobante-normalization.spec.md.
 */
export interface CanonicalVoucher {
  cuit_emisor: string; // 11 digits, punctuation stripped
  tipo_cbte: number; // canonical AFIP integer
  punto_venta: number;
  numero: number;
  fecha_emision: string; // ISO YYYY-MM-DD
  importe_total_ars: number; // signed: NC/ND negative
  iva: number; // IVA amount (ARS); drives priority sort of unmatched
  cae?: string;
  moneda: string; // "ARS" after normalization
  cotizacion?: number;
  file_source: 'arca' | 'contabilidad';
  source_row: VoucherRow;
}

/** A single reconciliation outcome row. */
export interface ReconciliationResult {
  id: string;
  tenant_id: TenantId;
  classification: Classification;
  arca_row: VoucherRow;
  tipo_clasificacion: Classification;
  iva_impacto: number;
  created_at: Date;
}
