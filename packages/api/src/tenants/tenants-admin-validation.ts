/**
 * tenants-admin-validation.ts — backoffice tenant CRUD (self-service admin
 * backoffice): pure request-shape validation for POST/PUT /api/tenants[/:id],
 * same dependency-free `{ok:true,value} | {ok:false,failure}` style as
 * comprobante-arca-manual-validation.ts. `cuit` reuses that file's own "11
 * digits, punctuation stripped" rule for cuit_emisor — same shape of number,
 * just on `tenants.cuit` (nullable column, 001_init_tenants.sql) instead of
 * a voucher's issuer.
 */

export interface TenantAdminRequestBody {
  name: string;
  cuit: string | null;
}

export type TenantAdminValidationFailure =
  | { code: 'INVALID_NAME'; status: 400; error: string }
  | { code: 'INVALID_CUIT'; status: 400; error: string };

export type TenantAdminValidationResult =
  | { ok: true; value: TenantAdminRequestBody }
  | { ok: false; failure: TenantAdminValidationFailure };

const MAX_NAME_LENGTH = 200;

function validateBody(body: unknown): TenantAdminValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      failure: { code: 'INVALID_NAME', status: 400, error: `name is required and must be 1-${MAX_NAME_LENGTH} characters` },
    };
  }

  // cuit is optional/nullable (tenants.cuit has no NOT NULL constraint) —
  // only validated when actually present, same "11 digits, punctuation
  // stripped" rule comprobante-arca-manual-validation.ts applies to
  // cuit_emisor.
  if (b.cuit === undefined || b.cuit === null) {
    return { ok: true, value: { name, cuit: null } };
  }

  const cuitDigits = typeof b.cuit === 'string' ? b.cuit.replace(/\D/g, '') : '';
  if (cuitDigits.length !== 11) {
    return {
      ok: false,
      failure: { code: 'INVALID_CUIT', status: 400, error: 'cuit must contain exactly 11 digits when present' },
    };
  }

  return { ok: true, value: { name, cuit: cuitDigits } };
}

export function validateCreateTenantBody(body: unknown): TenantAdminValidationResult {
  return validateBody(body);
}

export function validateUpdateTenantBody(body: unknown): TenantAdminValidationResult {
  return validateBody(body);
}
