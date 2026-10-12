/**
 * pendientes-historico-export-validation.ts — 2026-10-12 (Histórico filters
 * + export): pure request-shape validation for
 * `POST /api/tenants/:id/pendientes-historico/export`. Same
 * dependency-free, `{ok:true,value} | {ok:false,failure}` style as
 * comprobante-arca-archivar-validation.ts / comprobante-arca-manual-validation.ts.
 *
 * Only the request's own shape is validated here — `voucher_ids` must be a
 * non-empty array of UUID-shaped strings, `format` one of the 2 supported
 * literals. Whether an id actually resolves to a voucher belonging to this
 * tenant is NOT this function's concern (see fetchVouchersForExport's own
 * doc in pendientes-historico.ts: non-matching ids are silently excluded
 * from the export, not rejected).
 */
import { isUuid } from './tenants-validation';

export type PendientesHistoricoExportFormat = 'xlsx' | 'csv';

export interface PendientesHistoricoExportRequestBody {
  voucher_ids: string[];
  format: PendientesHistoricoExportFormat;
}

export type PendientesHistoricoExportValidationFailure =
  | { code: 'INVALID_VOUCHER_IDS'; status: 400; error: string }
  | { code: 'INVALID_FORMAT'; status: 400; error: string };

export type PendientesHistoricoExportValidationResult =
  | { ok: true; value: PendientesHistoricoExportRequestBody }
  | { ok: false; failure: PendientesHistoricoExportValidationFailure };

export function validatePendientesHistoricoExportRequest(body: unknown): PendientesHistoricoExportValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(b.voucher_ids) || b.voucher_ids.length === 0 || !b.voucher_ids.every((id) => isUuid(id))) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_VOUCHER_IDS',
        status: 400,
        error: 'voucher_ids is required and must be a non-empty array of UUIDs',
      },
    };
  }

  if (b.format !== 'xlsx' && b.format !== 'csv') {
    return {
      ok: false,
      failure: { code: 'INVALID_FORMAT', status: 400, error: "format must be 'xlsx' or 'csv'" },
    };
  }

  return {
    ok: true,
    value: { voucher_ids: b.voucher_ids as string[], format: b.format },
  };
}
