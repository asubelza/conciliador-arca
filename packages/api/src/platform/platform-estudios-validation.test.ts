import { validateCreateEstudioBody, validateInviteAdminBody } from './platform-estudios-validation';

describe('validateCreateEstudioBody', () => {
  it('accepts a trimmed, non-empty name', () => {
    const result = validateCreateEstudioBody({ name: '  Estudio Pérez & Asociados  ' });
    expect(result).toEqual({ ok: true, value: { name: 'Estudio Pérez & Asociados' } });
  });

  it('rejects a missing name', () => {
    const result = validateCreateEstudioBody({});
    expect(result).toEqual({
      ok: false,
      failure: { code: 'INVALID_NAME', status: 400, error: 'name is required and must be 1-200 characters' },
    });
  });

  it('rejects an empty/whitespace-only name', () => {
    const result = validateCreateEstudioBody({ name: '   ' });
    expect(result.ok).toBe(false);
  });

  it('rejects a name over 200 characters', () => {
    const result = validateCreateEstudioBody({ name: 'a'.repeat(201) });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string name', () => {
    const result = validateCreateEstudioBody({ name: 123 });
    expect(result.ok).toBe(false);
  });
});

describe('validateInviteAdminBody', () => {
  it('normalizes the email to lowercase/trimmed, with no display_name', () => {
    const result = validateInviteAdminBody({ email: '  Admin@Example.com  ' });
    expect(result).toEqual({ ok: true, value: { email: 'admin@example.com', display_name: null } });
  });

  it('accepts and trims a display_name', () => {
    const result = validateInviteAdminBody({ email: 'a@example.com', display_name: '  Juan  ' });
    expect(result).toEqual({ ok: true, value: { email: 'a@example.com', display_name: 'Juan' } });
  });

  it('rejects a missing email', () => {
    const result = validateInviteAdminBody({});
    expect(result).toEqual({
      ok: false,
      failure: { code: 'INVALID_EMAIL', status: 400, error: 'email is required and must be a valid email address' },
    });
  });

  it('rejects a malformed email', () => {
    const result = validateInviteAdminBody({ email: 'not-an-email' });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty display_name string', () => {
    const result = validateInviteAdminBody({ email: 'a@example.com', display_name: '   ' });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'INVALID_DISPLAY_NAME', status: 400, error: 'display_name must be a non-empty string when present' },
    });
  });

  it('does not accept role or tenant_ids — this route always creates an admin with zero tenant_ids', () => {
    const result = validateInviteAdminBody({ email: 'a@example.com', role: 'cliente', tenant_ids: ['x'] });
    expect(result).toEqual({ ok: true, value: { email: 'a@example.com', display_name: null } });
  });
});
