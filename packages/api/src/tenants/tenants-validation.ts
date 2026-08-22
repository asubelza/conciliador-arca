/**
 * tenants-validation.ts — T20 (RF-18): pure validation for
 * GET/PUT /api/tenants/:id/config.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantConfigValidationFailure =
  | { code: 'INVALID_TENANT_ID'; status: 400; error: string }
  | { code: 'INVALID_TOLERANCIA'; status: 400; error: string }
  | { code: 'INVALID_TOLERANCIA_DIAS'; status: 400; error: string };

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

/**
 * RF-13: mirrors tolerancia_redondeo_ars's own bound (tenants.tolerancia_dias_fecha
 * is INT CHECK(0..365), 019_alter_tenants_add_tolerancia_dias_fecha.sql) —
 * validated here too so an out-of-range value fails with a clear message
 * instead of surfacing as an opaque Postgres CHECK violation.
 */
const MAX_TOLERANCIA_DIAS = 365;

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

  const dias = b.tolerancia_dias_fecha;
  if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 0 || dias > MAX_TOLERANCIA_DIAS) {
    return {
      code: 'INVALID_TOLERANCIA_DIAS',
      status: 400,
      error: `tolerancia_dias_fecha is required and must be a whole number of days between 0 and ${MAX_TOLERANCIA_DIAS}`,
    };
  }

  return null;
}
