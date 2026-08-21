import { validateMarkRequest } from './marks-validation';

describe('T12 RF-11: validateMarkRequest', () => {
  it('accepts a minimal valid body (composite_key + classification only)', () => {
    const result = validateMarkRequest({ composite_key: '30111111112|1|1|1', classification: 'revisado' });
    expect(result).toEqual({
      ok: true,
      value: {
        composite_key: '30111111112|1|1|1',
        classification: 'revisado',
        note: null,
        user_id: null,
      },
    });
  });

  it('accepts a full valid body with note and a UUID user_id', () => {
    const result = validateMarkRequest({
      composite_key: '30111111112|1|1|1',
      classification: 'explicado',
      note: 'Nota de crédito por descuento comercial',
      user_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        composite_key: '30111111112|1|1|1',
        classification: 'explicado',
        note: 'Nota de crédito por descuento comercial',
        user_id: '11111111-1111-1111-1111-111111111111',
      },
    });
  });

  it('rejects a missing composite_key', () => {
    const result = validateMarkRequest({ classification: 'revisado' });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'MISSING_COMPOSITE_KEY', status: 400, error: 'composite_key is required' },
    });
  });

  it('rejects a blank composite_key', () => {
    const result = validateMarkRequest({ composite_key: '   ', classification: 'revisado' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('MISSING_COMPOSITE_KEY');
  });

  it('rejects a missing classification', () => {
    const result = validateMarkRequest({ composite_key: 'k' });
    expect(result).toEqual({
      ok: false,
      failure: {
        code: 'INVALID_CLASSIFICATION',
        status: 400,
        error: 'classification is required and must be one of: revisado, explicado',
      },
    });
  });

  it('rejects an unknown classification value', () => {
    const result = validateMarkRequest({ composite_key: 'k', classification: 'aprobado' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('INVALID_CLASSIFICATION');
  });

  it('rejects a non-UUID user_id', () => {
    const result = validateMarkRequest({ composite_key: 'k', classification: 'revisado', user_id: 'not-a-uuid' });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'INVALID_USER_ID', status: 400, error: 'user_id must be a UUID when provided' },
    });
  });

  it('handles undefined/null body without throwing', () => {
    expect(validateMarkRequest(undefined).ok).toBe(false);
    expect(validateMarkRequest(null).ok).toBe(false);
  });
});
