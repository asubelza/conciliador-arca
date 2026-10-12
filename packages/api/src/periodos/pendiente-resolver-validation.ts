/**
 * pendiente-resolver-validation.ts — 2026-08-23 (client request, feature 2
 * de 3): request-shape validation for `POST
 * /api/periodos/:id/pendientes-arca-resolver` ("Marcar como resuelto sin
 * pareja" — for an ARCA pendiente the contador knows will never find its
 * real contabilidad counterpart, e.g. loaded in ARCA many months before the
 * client started using the system). Same dependency-free style as
 * coincidencia-validation.ts / marks-validation.ts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendienteResolverRequestBody {
  arca_voucher_id: string;
  nota: string | null;
}

export type PendienteResolverValidationFailure =
  | { code: 'INVALID_ARCA_VOUCHER_ID'; status: 400; error: string }
  | { code: 'INVALID_NOTA'; status: 400; error: string };

export type PendienteResolverValidationResult =
  | { ok: true; value: PendienteResolverRequestBody }
  | { ok: false; failure: PendienteResolverValidationFailure };

export function validatePendienteResolverRequest(body: unknown): PendienteResolverValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.arca_voucher_id !== 'string' || !UUID_RE.test(b.arca_voucher_id)) {
    return {
      ok: false,
      failure: { code: 'INVALID_ARCA_VOUCHER_ID', status: 400, error: 'arca_voucher_id must be a UUID' },
    };
  }

  if (b.nota !== undefined && b.nota !== null && typeof b.nota !== 'string') {
    return { ok: false, failure: { code: 'INVALID_NOTA', status: 400, error: 'nota must be a string when present' } };
  }

  return {
    ok: true,
    value: { arca_voucher_id: b.arca_voucher_id, nota: (b.nota as string | undefined) ?? null },
  };
}
