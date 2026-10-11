/**
 * comprobante-normalizer.ts — T08 (RF-07): turns an adapted row
 * (column-adapters.ts) into a full `CanonicalVoucher` (packages/shared-types),
 * per comprobante-normalization.spec.md:
 *   - CUIT stripped to digits only (11-digit AFIP CUIT)
 *   - Argentine comma-decimal amounts -> numeric ("1.500,00" -> 1500)
 *   - dd/mm/yyyy or Excel serial dates -> ISO YYYY-MM-DD
 *   - NC/ND rows carry a negative importe_total_ars
 *   - unknown tipo_cbte (T07 couldn't resolve it) -> `ok: false`, the
 *     caller (T09/T10 classification) is expected to route this to the
 *     'errors' category per RF-06, with importe forced to 0 as the spec's
 *     "Unknown tipo code in input" scenario requires
 */
import type { AdaptedRow } from './column-adapters';
import type { CanonicalVoucher } from 'shared-types';

export interface NormalizeOutcome {
  voucher: CanonicalVoucher;
  /** false when tipo_cbte could not be resolved (RF-06 unknown-tipo path). */
  ok: boolean;
}

/** AFIP tipo integers that are Notas de Crédito or Débito (any letter). */
const NC_ND_TIPOS = new Set([2, 3, 7, 8, 12, 13, 20, 21]);

export function stripCuit(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/\D/g, '');
}

/**
 * Parses an Argentine-locale amount: '.' is the thousands separator, ','
 * is the decimal separator (e.g. "1.500,00" -> 1500). Accepts a plain JS
 * number too (xlsx numeric cells arrive already parsed) and passes it
 * through unchanged.
 */
export function parseArgentineAmount(raw: string | number | undefined): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return raw;

  const trimmed = raw.trim();
  if (trimmed === '') return 0;

  // Has a comma -> treat as Argentine locale (dots are thousands seps).
  if (trimmed.includes(',')) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  // No comma: could be a plain integer/decimal already, e.g. "500".
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // day 0 for Excel's serial date system

/** Converts an Excel date serial (e.g. 44197) to an ISO YYYY-MM-DD string. */
export function excelSerialToIsoDate(serial: number): string {
  const ms = EXCEL_EPOCH_MS + serial * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parses `dd/mm/yyyy` or an Excel date serial into an ISO YYYY-MM-DD
 * string. Returns '' for unparseable/absent input rather than throwing —
 * a bad date does not need to fail the whole row (RF-06 only mandates the
 * 'errors' path for unknown tipo).
 */
export function parseFechaEmision(raw: string | number | undefined): string {
  if (raw === undefined || raw === null || raw === '') return '';

  if (typeof raw === 'number') return excelSerialToIsoDate(raw);

  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return excelSerialToIsoDate(Number(trimmed));

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // Already ISO or otherwise unrecognized — pass through as-is rather
  // than silently discard information the caller might still use.
  return trimmed;
}

function isNcNd(tipoCbte: number | undefined): boolean {
  return tipoCbte !== undefined && NC_ND_TIPOS.has(tipoCbte);
}

export function normalizeRow(
  fileSource: 'arca' | 'contabilidad',
  adapted: AdaptedRow,
): NormalizeOutcome {
  const ok = adapted.tipo_cbte !== undefined;

  // RF-06 "unknown tipo" scenario: importe forced to 0, not just skipped.
  const importeParsed = ok ? parseArgentineAmount(adapted.importe_total_raw) : 0;
  const signedImporte = ok && isNcNd(adapted.tipo_cbte) ? -Math.abs(importeParsed) : importeParsed;

  const voucher: CanonicalVoucher = {
    cuit_emisor: stripCuit(adapted.cuit_emisor_raw),
    tipo_cbte: adapted.tipo_cbte ?? 0,
    punto_venta: Number(adapted.punto_venta_raw) || 0,
    numero: Number(adapted.numero_raw) || 0,
    fecha_emision: parseFechaEmision(adapted.fecha_emision_raw),
    importe_total_ars: signedImporte,
    // IVA line-item extraction isn't available yet from any adapter (same
    // documented gap as PR-2's progress notes: "IVA queda en 0" until an
    // adapter confirms where it lives in each export) — T09's priority
    // sort by iva_amount will need this filled in once that's confirmed.
    iva: 0,
    moneda: 'ARS',
    file_source: fileSource,
    source_row: adapted.source_row,
  };

  return { voucher, ok };
}
