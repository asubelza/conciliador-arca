/**
 * auth.service.ts — T34/T35 (autenticacion-roles/RF-14): the actual login
 * logic — looks up the user by email, verifies the password, issues a JWT.
 * Returns a typed failure rather than throwing (same style as
 * periodo-cierre.ts/periodo-report.ts), and always the SAME generic
 * "credenciales inválidas" message whether the email doesn't exist, the
 * password is wrong, or the account is deactivated — never reveals which
 * one, so a caller can't enumerate valid emails.
 */
import type { Pool } from 'pg';
import { verifyPassword } from './password';
import { signToken } from './jwt';
import type { UserRow, UserRole } from './users-types';

export type LoginFailure = { code: 'INVALID_CREDENTIALS'; status: 401; error: string };

export interface LoginResult {
  token: string;
  user: { id: string; email: string; role: UserRole; display_name: string | null };
}

const INVALID_CREDENTIALS: LoginFailure = {
  code: 'INVALID_CREDENTIALS',
  status: 401,
  error: 'email o contraseña inválidos',
};

export async function login(pool: Pool, email: string, password: string): Promise<LoginResult | LoginFailure> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, password_hash, role, display_name, is_active FROM users WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    return INVALID_CREDENTIALS;
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    return INVALID_CREDENTIALS;
  }

  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  return {
    token,
    user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name },
  };
}
