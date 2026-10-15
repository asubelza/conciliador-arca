/**
 * comprobante-arca-archivar-validation.ts — 2026-10-12 (Histórico filters +
 * "Archivar"): pure request-shape validation for both archive endpoints —
 * `POST /api/tenants/:id/comprobantes/:voucherId/archivar` (single) and
 * `POST /api/tenants/:id/comprobantes/archivar-lote` (bulk). Same
 * dependency-free, `{ok:true,value} | {ok:false,failure}` style as
 * pendiente-resolver-validation.ts / comprobante-arca-manual-validation.ts.
 */
import { isUuid } from './tenants-validation';

export interface ArchivarComprobanteRequestBody {
  nota: string | null;
}

export type ArchivarComprobanteValidationFailure = { code: 'INVALID_NOTA'; status: 400; error: string };

export type ArchivarComprobanteValidationResult =
  | { ok: true; value: ArchivarComprobanteRequestBody }
  | { ok: false; failure: ArchivarComprobanteValidationFailure };

export function validateArchivarComprobanteRequest(body: unknown): ArchivarComprobanteValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.nota !== undefined && b.nota !== null && typeof b.nota !== 'string') {
    return { ok: false, failure: { code: 'INVALID_NOTA', status: 400, error: 'nota must be a string when present' } };
  }

  return { ok: true, value: { nota: (b.nota as string | undefined) ?? null } };
}

export interface ArchivarComprobantesLoteRequestBody {
  voucher_ids: string[];
  nota: string | null;
}

export type ArchivarComprobantesLoteValidationFailure =
  | { code: 'INVALID_VOUCHER_IDS'; status: 400; error: string }
  | { code: 'INVALID_NOTA'; status: 400; error: string };

export type ArchivarComprobantesLoteValidationResult =
  | { ok: true; value: ArchivarComprobantesLoteRequestBody }
  | { ok: false; failure: ArchivarComprobantesLoteValidationFailure };

/**
 * `voucher_ids` must be a non-empty array of UUID strings — every other
 * per-id failure mode (not found, wrong tenant, wrong file_source, already
 * conciliado/archivado) is a per-id *skip reason* in the response body
 * (RNF-07 "nunca ocultar" — see comprobante-arca-archivar.ts), not a 400.
 * Only the request's own shape is validated here.
 */
export function validateArchivarComprobantesLoteRequest(body: unknown): ArchivarComprobantesLoteValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (
    !Array.isArray(b.voucher_ids) ||
    b.voucher_ids.length === 0 ||
    !b.voucher_ids.every((id) => isUuid(id))
  ) {
    return {
      ok: false,
      failure: { code: 'INVALID_VOUCHER_IDS', status: 400, error: 'voucher_ids is required and must be a non-empty array of UUIDs' },
    };
  }

  if (b.nota !== undefined && b.nota !== null && typeof b.nota !== 'string') {
    return { ok: false, failure: { code: 'INVALID_NOTA', status: 400, error: 'nota must be a string when present' } };
  }

  return {
    ok: true,
    value: { voucher_ids: b.voucher_ids as string[], nota: (b.nota as string | undefined) ?? null },
  };
}
