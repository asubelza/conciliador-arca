import { validateCreateUserBody } from './users-validation';

const VALID_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';

describe('validateCreateUserBody', () => {
  it('accepts an admin with no tenant_ids and normalizes the email to lowercase/trimmed', () => {
    const result = validateCreateUserBody({ email: '  Admin@Example.com  ', role: 'admin' });
    expect(result).toEqual({ ok: true, value: { email: 'admin@example.com', role: 'admin', display_name: null, tenant_ids: [] } });
  });

  it('accepts a colaborador with no tenant_ids', () => {
    const result = validateCreateUserBody({ email: 'colab@example.com', role: 'colaborador' });
    expect(result.ok).toBe(true);
  });

  it('accepts display_name and trims it', () => {
    const result = validateCreateUserBody({ email: 'a@example.com', role: 'admin', display_name: '  Juan  ' });
    expect(result).toEqual({
      ok: true,
      value: { email: 'a@example.com', role: 'admin', display_name: 'Juan', tenant_ids: [] },
    });
  });

  it('accepts a cliente with a non-empty tenant_ids array', () => {
    const result = validateCreateUserBody({ email: 'c@example.com', role: 'cliente', tenant_ids: [VALID_TENANT_ID, OTHER_TENANT_ID] });
    expect(result).toEqual({
      ok: true,
      value: { email: 'c@example.com', role: 'cliente', display_name: null, tenant_ids: [VALID_TENANT_ID, OTHER_TENANT_ID] },
    });
  });

  it('deduplicates a repeated tenant id', () => {
    const result = validateCreateUserBody({ email: 'c@example.com', role: 'cliente', tenant_ids: [VALID_TENANT_ID, VALID_TENANT_ID, OTHER_TENANT_ID] });
    expect(result).toEqual({
      ok: true,
      value: { email: 'c@example.com', role: 'cliente', display_name: null, tenant_ids: [VALID_TENANT_ID, OTHER_TENANT_ID] },
    });
  });

  it('rejects an empty email', () => {
    const result = validateCreateUserBody({ email: '', role: 'admin' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_EMAIL' }) });
  });

  it('rejects a malformed email', () => {
    const result = validateCreateUserBody({ email: 'not-an-email', role: 'admin' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_EMAIL' }) });
  });

  it('rejects a missing role', () => {
    const result = validateCreateUserBody({ email: 'a@example.com' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_ROLE' }) });
  });

  it('rejects an unrecognized role', () => {
    const result = validateCreateUserBody({ email: 'a@example.com', role: 'superadmin' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_ROLE' }) });
  });

  it('rejects an empty-string display_name', () => {
    const result = validateCreateUserBody({ email: 'a@example.com', role: 'admin', display_name: '   ' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_DISPLAY_NAME' }) });
  });

  it('rejects role=cliente with no tenant_ids', () => {
    const result = validateCreateUserBody({ email: 'c@example.com', role: 'cliente' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_TENANT_IDS' }) });
  });

  it('rejects role=cliente with an empty tenant_ids array', () => {
    const result = validateCreateUserBody({ email: 'c@example.com', role: 'cliente', tenant_ids: [] });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_TENANT_IDS' }) });
  });

  it('rejects role=cliente with a malformed tenant id in the array', () => {
    const result = validateCreateUserBody({ email: 'c@example.com', role: 'cliente', tenant_ids: [VALID_TENANT_ID, 'not-a-uuid'] });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_TENANT_IDS' }) });
  });

  it('rejects role=admin with a non-empty tenant_ids (explicit rejection, not silently ignored)', () => {
    const result = validateCreateUserBody({ email: 'a@example.com', role: 'admin', tenant_ids: [VALID_TENANT_ID] });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_TENANT_IDS' }) });
  });

  it('rejects role=colaborador with a non-empty tenant_ids', () => {
    const result = validateCreateUserBody({ email: 'b@example.com', role: 'colaborador', tenant_ids: [VALID_TENANT_ID] });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_TENANT_IDS' }) });
  });
});
