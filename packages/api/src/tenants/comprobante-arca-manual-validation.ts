/**
 * comprobante-arca-manual-validation.ts — 2026-10-12: pure request-shape
 * validation for `POST /api/tenants/:id/comprobantes-arca` ("manual ARCA
 * voucher creation" — a contador registers a comprobante found directly in
 * AFIP's own portal that was never captured by any uploaded ARCA file, so
 * it enters the normal matching engine as a regular pendiente ARCA
 * voucher). Same dependency-free, `{ok:true,value} | {ok:false,failure}`
 * style as pendiente-resolver-validation.ts / coincidencia-validation.ts.
 */
import { isValidAfipTipo, AFIP_TIPOS_CADENCIAL, type AfipTipo } from 'shared-types';

export interface ComprobanteArcaManualRequestBody {
  cuit_emisor: string; // 11 digits, punctuation already stripped
  tipo_cbte: AfipTipo;
  punto_venta: number;
  numero: number;
  fecha_emision: string; // ISO 'YYYY-MM-DD'
  importe_total_ars: number;
  iva: number; // defaults to 0 when omitted
}

export type ComprobanteArcaManualValidationFailure =
  | { code: 'INVALID_CUIT_EMISOR'; status: 400; error: string }
  | { code: 'INVALID_TIPO_CBTE'; status: 400; error: string }
  | { code: 'INVALID_PUNTO_VENTA'; status: 400; error: string }
  | { code: 'INVALID_NUMERO'; status: 400; error: string }
  | { code: 'INVALID_FECHA_EMISION'; status: 400; error: string }
  | { code: 'INVALID_IMPORTE_TOTAL_ARS'; status: 400; error: string }
  | { code: 'INVALID_IVA'; status: 400; error: string };

export type ComprobanteArcaManualValidationResult =
  | { ok: true; value: ComprobanteArcaManualRequestBody }
  | { ok: false; failure: ComprobanteArcaManualValidationFailure };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects both malformed strings and calendar-invalid dates (e.g. '2026-02-30'), same spirit as the ARCA normalizer's own date parsing. */
function isValidIsoDate(value: string): boolean {
  if (!FECHA_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function validateComprobanteArcaManualRequest(body: unknown): ComprobanteArcaManualValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  // Same "11 digits, punctuation stripped" normalization comprobante-normalizer.ts's
  // stripCuit() applies to every uploaded row — a manual entry gets the same treatment.
  const cuitDigits = typeof b.cuit_emisor === 'string' ? b.cuit_emisor.replace(/\D/g, '') : '';
  if (cuitDigits.length !== 11) {
    return {
      ok: false,
      failure: { code: 'INVALID_CUIT_EMISOR', status: 400, error: 'cuit_emisor is required and must contain exactly 11 digits' },
    };
  }

  if (typeof b.tipo_cbte !== 'number' || !isValidAfipTipo(b.tipo_cbte)) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_TIPO_CBTE',
        status: 400,
        error: `tipo_cbte is required and must be one of the recognized AFIP tipo codes: ${AFIP_TIPOS_CADENCIAL.join(', ')}`,
      },
    };
  }

  if (!isNonNegativeInteger(b.punto_venta)) {
    return {
      ok: false,
      failure: { code: 'INVALID_PUNTO_VENTA', status: 400, error: 'punto_venta is required and must be a non-negative whole number' },
    };
  }

  if (!isNonNegativeInteger(b.numero)) {
    return {
      ok: false,
      failure: { code: 'INVALID_NUMERO', status: 400, error: 'numero is required and must be a non-negative whole number' },
    };
  }

  if (typeof b.fecha_emision !== 'string' || !isValidIsoDate(b.fecha_emision)) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_FECHA_EMISION',
        status: 400,
        error: "fecha_emision is required and must be a valid ISO date (\'YYYY-MM-DD\')",
      },
    };
  }

  // Signed, not forced non-negative: NC/ND comprobantes are legitimately
  // negative (same convention as CanonicalVoucher.importe_total_ars).
  if (typeof b.importe_total_ars !== 'number' || !Number.isFinite(b.importe_total_ars)) {
    return {
      ok: false,
      failure: { code: 'INVALID_IMPORTE_TOTAL_ARS', status: 400, error: 'importe_total_ars is required and must be a finite number' },
    };
  }

  if (b.iva !== undefined && (typeof b.iva !== 'number' || !Number.isFinite(b.iva))) {
    return { ok: false, failure: { code: 'INVALID_IVA', status: 400, error: 'iva must be a finite number when present' } };
  }

  return {
    ok: true,
    value: {
      cuit_emisor: cuitDigits,
      tipo_cbte: b.tipo_cbte,
      punto_venta: b.punto_venta,
      numero: b.numero,
      fecha_emision: b.fecha_emision,
      importe_total_ars: b.importe_total_ars,
      iva: (b.iva as number | undefined) ?? 0,
    },
  };
}
