/**
 * tenants-validation.ts — T20 (RF-18): pure validation for
 * GET/PUT /api/tenants/:id/config.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantConfigValidationFailure =
  | { code: 'INVALID_TENANT_ID'; status: 400; error: string }
  | { code: 'INVALID_TOLERANCIA'; status: 400; error: string };

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function validateTenantIdParam(value: unknown): TenantConfigValidationFailure | null {
  if (!isUuid(value)) {
    return { code: 'INVALID_TENANT_ID', status: 400, error: 'tenant id must be a UUID' };
  }
  return null;
}

/**
 * `tolerancia_redondeo_ars` is a NUMERIC(10,2) column — a non-negative
 * finite number, capped well under NUMERIC(10,2)'s own range so an
 * out-of-range value fails here with a clear message rather than as an
 * opaque Postgres "numeric field overflow" error.
 */
const MAX_TOLERANCIA = 99999999.99;

export function validateUpdateTenantConfigBody(body: unknown): TenantConfigValidationFailure | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const value = b.tolerancia_redondeo_ars;

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_TOLERANCIA) {
    return {
      code: 'INVALID_TOLERANCIA',
      status: 400,
      error: `tolerancia_redondeo_ars is required and must be a number between 0 and ${MAX_TOLERANCIA}`,
    };
  }
  return null;
}
