/**
 * auth-validation.ts — T35 (autenticacion-roles/RF-14): request-shape
 * validation for POST /api/auth/login, same "pure function checked before
 * any DB/bcrypt work" style as upload-validation.ts/periodos-validation.ts.
 */
export interface ValidationFailure {
  code: string;
  status: number;
  error: string;
}

export function validateLoginBody(body: unknown): ValidationFailure | null {
  if (typeof body !== 'object' || body === null) {
    return { code: 'INVALID_BODY', status: 400, error: 'email and password are required' };
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email.trim().length === 0) {
    return { code: 'INVALID_EMAIL', status: 400, error: 'email is required and must be a string' };
  }
  if (typeof password !== 'string' || password.length === 0) {
    return { code: 'INVALID_PASSWORD', status: 400, error: 'password is required and must be a string' };
  }
  return null;
}
