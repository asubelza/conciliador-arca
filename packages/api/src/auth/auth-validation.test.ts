import { validateLoginBody } from './auth-validation';

describe('T35: validateLoginBody', () => {
  it('accepts a well-formed body', () => {
    expect(validateLoginBody({ email: 'a@b.com', password: 'secret' })).toBeNull();
  });

  it('rejects a missing email', () => {
    expect(validateLoginBody({ password: 'secret' })?.code).toBe('INVALID_EMAIL');
  });

  it('rejects a missing password', () => {
    expect(validateLoginBody({ email: 'a@b.com' })?.code).toBe('INVALID_PASSWORD');
  });

  it('rejects a non-object body', () => {
    expect(validateLoginBody('not-an-object')?.code).toBe('INVALID_BODY');
    expect(validateLoginBody(null)?.code).toBe('INVALID_BODY');
  });

  it('rejects an empty-string email/password', () => {
    expect(validateLoginBody({ email: '', password: 'secret' })?.code).toBe('INVALID_EMAIL');
    expect(validateLoginBody({ email: 'a@b.com', password: '' })?.code).toBe('INVALID_PASSWORD');
  });
});
