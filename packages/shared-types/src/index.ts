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
 *
 * 15, 51 and 81 added 2026-08-23 after a real client ARCA "Comprobantes
 * Recibidos" export (995 rows) surfaced them as genuine, currently-issued
 * AFIP comprobante types the catalogue didn't recognize yet — confirmed
 * against AFIP's own published "Tabla de Comprobantes" (not guessed):
 * 15 = Recibo C, 81 = Tique-Factura A / Controladores Fiscales (matches
 * AFIP's own bienes-de-uso reference table verbatim). 51 is the more
 * interesting one: it used to mean "Factura M", but RG 5762/2025 ("Fin de
 * las facturas M") repurposed code 51 to mean "Factura A con leyenda
 * Operación Sujeta a Retención" instead — a DIFFERENT comprobante type
 * that explicitly is *not* Factura M even though it reuses the same
 * numeric code. The real export's own description for its "51" rows
 * ("Factura A con leyenda Operación Sujeta a Retención") matches this
 * current, post-2025 meaning exactly, so that's the label used here —
 * not "Factura M", which would now be wrong for new exports.
 */
export const AFIP_TIPOS_CADENCIAL: AfipTipo[] = [
  1, 2, 3, 6, 7, 8, 11, 12, 13, 15, 19, 20, 21, 51, 81,
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
  15: 'RECIBO_C',
  19: 'FACTURA_E',
  20: 'NOTA_DEBITO_E',
  21: 'NOTA_CREDITO_E',
  51: 'FACTURA_A_LEYENDA_RETENCION',
  81: 'TIQUE_FACTURA_A',
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
  tipo_cbte: AfipTipo; // canonical AFIP tipo integer (real "Tabla de Comprobantes" code)
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

/**
 * Success body of `POST /api/periodos/:id/reabrir` (dashboard-principal,
 * RF-33 / design §Interfaces): the reopened período row with cierre's
 * column set reset to NULL, plus how much of cierre's write set was
 * undone — vouchers returned to `pendiente` with their
 * `periodo_cierre_id` stamp cleared, and frozen snapshot rows deleted.
 * Failures stay house-shape `{ error: string }` (400/403/404/409).
 */
export interface PeriodoReabrirResponse {
  periodo: {
    id: string;
    tenant_id: string;
    mes: string;
    estado: 'abierto';
    tolerancia_ars: null;
    cerrado_at: null;
    cerrado_por: null;
  };
  counts: {
    vouchers_reabiertos: number;
    resultados_eliminados: number;
  };
}

/**
 * Success body of `DELETE /api/periodos/:id` (RF-35): the período was
 * physically deleted (only possible when nothing referenced it — otherwise
 * a plain-language 409 names the blockers).
 */
export interface PeriodoDeleteResponse {
  deleted: true;
  periodo_id: string;
}
