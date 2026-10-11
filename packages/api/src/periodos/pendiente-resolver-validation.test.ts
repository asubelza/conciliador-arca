import { validatePendienteResolverRequest } from './pendiente-resolver-validation';

const ARCA_ID = '123e4567-e89b-12d3-a456-426614174001';

describe('2026-08-23 (feature 2 de 3): validatePendienteResolverRequest', () => {
  it('accepts a well-formed body with a nota', () => {
    const result = validatePendienteResolverRequest({ arca_voucher_id: ARCA_ID, nota: 'nunca va a matchear' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ arca_voucher_id: ARCA_ID, nota: 'nunca va a matchear' });
  });

  it('accepts a well-formed body without a nota (defaults to null)', () => {
    const result = validatePendienteResolverRequest({ arca_voucher_id: ARCA_ID });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ arca_voucher_id: ARCA_ID, nota: null });
  });

  it('accepts an explicit nota: null', () => {
    const result = validatePendienteResolverRequest({ arca_voucher_id: ARCA_ID, nota: null });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.nota).toBeNull();
  });

  it('rejects a missing/malformed arca_voucher_id', () => {
    const result = validatePendienteResolverRequest({});
    expect(!result.ok && result.failure.code).toBe('INVALID_ARCA_VOUCHER_ID');

    const result2 = validatePendienteResolverRequest({ arca_voucher_id: 'nope' });
    expect(!result2.ok && result2.failure.code).toBe('INVALID_ARCA_VOUCHER_ID');
  });

  it('rejects a non-string nota', () => {
    const result = validatePendienteResolverRequest({ arca_voucher_id: ARCA_ID, nota: 42 });
    expect(!result.ok && result.failure.code).toBe('INVALID_NOTA');
  });

  it('handles a non-object body', () => {
    const result = validatePendienteResolverRequest(null);
    expect(result.ok).toBe(false);
  });
});
