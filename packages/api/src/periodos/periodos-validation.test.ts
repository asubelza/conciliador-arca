import {
  isUuid,
  validateCreatePeriodoBody,
  validatePeriodoIdParam,
  validateTenantIdQuery,
} from './periodos-validation';

/**
 * T18 — RF-12 (openspec/specs/conciliacion-periodica/periodos.spec.md)
 *
 * Pure-function unit tests for the /api/periodos request-shape validation,
 * independent of NestJS/HTTP/pg — periodos.controller.test.ts covers the
 * DB-backed behavior (uniqueness, 404s) end to end.
 */
const VALID_TENANT = '123e4567-e89b-12d3-a456-426614174000';

describe('T18: isUuid', () => {
  it('accepts a well-formed UUID (any case)', () => {
    expect(isUuid(VALID_TENANT)).toBe(true);
    expect(isUuid(VALID_TENANT.toUpperCase())).toBe(true);
  });

  it('rejects non-UUID strings and non-strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe('T18: validateCreatePeriodoBody (RF-12)', () => {
  it('accepts a well-formed body with a YYYY-MM-DD mes', () => {
    expect(validateCreatePeriodoBody({ tenant_id: VALID_TENANT, mes: '2026-04-01' })).toBeNull();
  });

  it('accepts a well-formed body with a YYYY-MM mes (normalized to month-start downstream)', () => {
    expect(validateCreatePeriodoBody({ tenant_id: VALID_TENANT, mes: '2026-04' })).toBeNull();
  });

  it('rejects a missing/non-UUID tenant_id', () => {
    expect(validateCreatePeriodoBody({ mes: '2026-04-01' })).toEqual({
      code: 'INVALID_TENANT_ID',
      status: 400,
      error: 'tenant_id is required and must be a UUID',
    });
    expect(validateCreatePeriodoBody({ tenant_id: 'nope', mes: '2026-04-01' })?.code).toBe(
      'INVALID_TENANT_ID',
    );
  });

  it('rejects a missing/malformed mes', () => {
    expect(validateCreatePeriodoBody({ tenant_id: VALID_TENANT })?.code).toBe('INVALID_MES');
    expect(validateCreatePeriodoBody({ tenant_id: VALID_TENANT, mes: 'abril 2026' })?.code).toBe(
      'INVALID_MES',
    );
    expect(validateCreatePeriodoBody({ tenant_id: VALID_TENANT, mes: 2026 })?.code).toBe('INVALID_MES');
  });

  it('handles a non-object body', () => {
    expect(validateCreatePeriodoBody(null)?.code).toBe('INVALID_TENANT_ID');
    expect(validateCreatePeriodoBody(undefined)?.code).toBe('INVALID_TENANT_ID');
  });
});

describe('T18: validateTenantIdQuery', () => {
  it('accepts a well-formed UUID', () => {
    expect(validateTenantIdQuery(VALID_TENANT)).toBeNull();
  });

  it('rejects a missing/malformed tenant_id', () => {
    expect(validateTenantIdQuery(undefined)?.code).toBe('INVALID_TENANT_ID');
    expect(validateTenantIdQuery('nope')?.code).toBe('INVALID_TENANT_ID');
  });
});

describe('T18: validatePeriodoIdParam', () => {
  it('accepts a well-formed UUID', () => {
    expect(validatePeriodoIdParam(VALID_TENANT)).toBeNull();
  });

  it('rejects a missing/malformed id', () => {
    expect(validatePeriodoIdParam(undefined)?.code).toBe('INVALID_PERIODO_ID');
    expect(validatePeriodoIdParam('nope')?.code).toBe('INVALID_PERIODO_ID');
  });
});
