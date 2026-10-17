import { validateAcceptInviteBody, validateInviteTokenParam } from './accept-invite-validation';

const VALID_TOKEN = 'a'.repeat(64);

describe('validateInviteTokenParam', () => {
  it('accepts a 64-char lowercase hex token', () => {
    expect(validateInviteTokenParam(VALID_TOKEN)).toBeNull();
  });

  it('rejects a token with the wrong length', () => {
    expect(validateInviteTokenParam('a'.repeat(63))).toEqual(expect.objectContaining({ code: 'INVALID_TOKEN' }));
  });

  it('rejects a token with non-hex characters', () => {
    expect(validateInviteTokenParam('g'.repeat(64))).toEqual(expect.objectContaining({ code: 'INVALID_TOKEN' }));
  });

  it('rejects a non-string value', () => {
    expect(validateInviteTokenParam(123)).toEqual(expect.objectContaining({ code: 'INVALID_TOKEN' }));
  });
});

describe('validateAcceptInviteBody', () => {
  it('accepts a valid token + an 8+ character password', () => {
    const result = validateAcceptInviteBody({ token: VALID_TOKEN, password: 'correcto1' });
    expect(result).toEqual({ ok: true, value: { token: VALID_TOKEN, password: 'correcto1' } });
  });

  it('rejects a malformed token', () => {
    const result = validateAcceptInviteBody({ token: 'not-a-token', password: 'correcto1' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'INVALID_TOKEN' }) });
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = validateAcceptInviteBody({ token: VALID_TOKEN, password: 'short1' });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'WEAK_PASSWORD' }) });
  });

  it('rejects a missing password', () => {
    const result = validateAcceptInviteBody({ token: VALID_TOKEN });
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'WEAK_PASSWORD' }) });
  });
});
