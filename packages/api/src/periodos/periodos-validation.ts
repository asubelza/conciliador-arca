/**
 * periodos-validation.ts — T18 (RF-12): pure, DB-free validation for
 * POST /api/periodos's request body and the tenant_id/id path/query params
 * the períodos endpoints take. Kept dependency-free (no NestJS/pg types),
 * same split as upload-validation.ts: DB-backed checks (uniqueness per
 * tenant+month, existence) stay in periodos.controller.ts, which is the
 * only place with a Pool.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts 'YYYY-MM' or 'YYYY-MM-DD' — either is normalized to the 1st of the
// month by the controller's INSERT (`date_trunc('month', $1::date)`), so this
// only needs to reject obviously-malformed input before it reaches Postgres.
const MES_RE = /^\d{4}-\d{2}(-\d{2})?$/;

export type PeriodoValidationFailure =
  | { code: 'INVALID_TENANT_ID'; status: 400; error: string }
  | { code: 'INVALID_MES'; status: 400; error: string }
  | { code: 'INVALID_PERIODO_ID'; status: 400; error: string }
  | { code: 'INVALID_CERRADO_POR'; status: 400; error: string };

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** RF-12: validates the POST /api/periodos body ({ tenant_id, mes }). */
export function validateCreatePeriodoBody(body: unknown): PeriodoValidationFailure | null {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.tenant_id)) {
    return { code: 'INVALID_TENANT_ID', status: 400, error: 'tenant_id is required and must be a UUID' };
  }
  if (typeof b.mes !== 'string' || !MES_RE.test(b.mes)) {
    return {
      code: 'INVALID_MES',
      status: 400,
      error: "mes is required and must be a date like 'YYYY-MM' or 'YYYY-MM-DD'",
    };
  }
  return null;
}

/** GET /api/periodos?tenant_id=... */
export function validateTenantIdQuery(value: unknown): PeriodoValidationFailure | null {
  if (!isUuid(value)) {
    return { code: 'INVALID_TENANT_ID', status: 400, error: 'tenant_id query param is required and must be a UUID' };
  }
  return null;
}

/** GET/POST /api/periodos/:id[/cerrar] — the :id path param itself. */
export function validatePeriodoIdParam(value: unknown): PeriodoValidationFailure | null {
  if (!isUuid(value)) {
    return { code: 'INVALID_PERIODO_ID', status: 400, error: 'periodo id must be a UUID' };
  }
  return null;
}

/**
 * T27 (RF-20): `POST /api/periodos/:id/cerrar`'s optional body —
 * `cerrado_por` is a free-text label (no auth/user system exists yet in
 * this codebase, same gap noted for `feedback_loop.user_id`), so this only
 * rejects a non-string value; an absent body or missing field is valid
 * (persisted as NULL, same as periodos.cerrado_por's nullable column).
 */
export function validateCerrarBody(body: unknown): PeriodoValidationFailure | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.cerrado_por !== undefined && b.cerrado_por !== null && typeof b.cerrado_por !== 'string') {
    return { code: 'INVALID_CERRADO_POR', status: 400, error: 'cerrado_por must be a string when provided' };
  }
  return null;
}
