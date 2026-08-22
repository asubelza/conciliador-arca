import { isUuid, validateTenantIdParam, validateUpdateTenantConfigBody } from './tenants-validation';

/**
 * T20 — pure-function unit tests for GET/PUT /api/tenants/:id/config's
 * request-shape validation. tenants.controller.test.ts covers the DB-backed
 * behavior end to end.
 */
const VALID_TENANT = '123e4567-e89b-12d3-a456-426614174000';

describe('T20: isUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(isUuid(VALID_TENANT)).toBe(true);
  });

  it('rejects non-UUID values', () => {
    expect(isUuid('nope')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('T20: validateTenantIdParam', () => {
  it('accepts a well-formed UUID', () => {
    expect(validateTenantIdParam(VALID_TENANT)).toBeNull();
  });

  it('rejects a missing/malformed id', () => {
    expect(validateTenantIdParam(undefined)?.code).toBe('INVALID_TENANT_ID');
    expect(validateTenantIdParam('nope')?.code).toBe('INVALID_TENANT_ID');
  });
});

describe('T20: validateUpdateTenantConfigBody (RF-18)', () => {
  it('accepts a valid non-negative number', () => {
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: 0.99 })).toBeNull();
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: 0 })).toBeNull();
  });

  it('rejects a missing value', () => {
    expect(validateUpdateTenantConfigBody({})?.code).toBe('INVALID_TOLERANCIA');
  });

  it('rejects a negative value', () => {
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: -1 })?.code).toBe('INVALID_TOLERANCIA');
  });

  it('rejects a non-numeric value', () => {
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: '0.99' })?.code).toBe(
      'INVALID_TOLERANCIA',
    );
  });

  it('rejects NaN/Infinity', () => {
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: NaN })?.code).toBe('INVALID_TOLERANCIA');
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: Infinity })?.code).toBe(
      'INVALID_TOLERANCIA',
    );
  });

  it('rejects an absurdly large value (guards the NUMERIC(10,2) column range)', () => {
    expect(validateUpdateTenantConfigBody({ tolerancia_redondeo_ars: 1e15 })?.code).toBe('INVALID_TOLERANCIA');
  });
});
