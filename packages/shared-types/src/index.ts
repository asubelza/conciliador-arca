/**
 * shared-types — canonical data contracts for conciliador-arca.
 *
 * This package is the single source of truth for the AFIP comprobante tipo
 * catalogue and the canonical voucher reconciliation DTOs shared across the
 * API, web frontend, and seed pipeline.
 */

/** Zero-padded 3-digit AFIP comprobante tipo code, e.g. "001" (Factura). */
export type AfipTipo = string;

/**
 * The 15 canonical AFIP tipos commonly exchanged between ARCA and Argentine
 * accounting systems. Kept as a readonly tuple so consumers cannot import
 * an unknown tipo at runtime. See comprobante-normalization.spec.md (RF-06).
 */
export const AFIP_TIPOS_CADENCIAL: AfipTipo[] = [
  '001', '002', '003', '004', '005',
  '006', '007', '008', '011', '014',
  '015', '021', '022', '023', '024',
];

/** Human-readable label keyed by canonical AFIP tipo code. */
export const AFIP_TIPO_LABELS: Record<AfipTipo, string> = {
  '001': 'FACTURA',
  '002': 'NOTA_DE_VENTA',
  '003': 'FACTURA_B',
  '004': 'FACTURA_C',
  '005': 'NOTA_DE_CREDITO',
  '006': 'NOTA_DE_DEBITO',
  '007': 'FACTURA_EXPORTACION',
  '008': 'FACTURA_B_EXPORTACION',
  '011': 'NOTA_CREDITO_EXPORTACION',
  '014': 'NOTA_DEBITO_EXPORTACION',
  '015': 'RECIBO',
  '021': 'NOTA_DE_RETENCION',
  '022': 'NOTA_DE_RETENCION_ENTIDADES',
  '023': 'NOTA_DE_RETENCION_PERSONAS',
  '024': 'COMPROBANTE_DE_RETENCION',
};

/** Enum-like lookup mirroring AFIP_TIPO_LABELS (code -> label). */
export const ComprobanteTipo = AFIP_TIPO_LABELS;

/** Type guard: true only for the 15 canonical AFIP tipos. */
export function isValidAfipTipo(value: string): value is AfipTipo {
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
  tipo_cbte: AfipTipo; // canonical AFIP tipo (zero-padded 3-digit string, e.g. "001")
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
