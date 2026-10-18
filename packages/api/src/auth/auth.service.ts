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
import type { AuthenticatedUser, UserRow, UserRole } from './users-types';

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

export interface MyTenantRow {
  id: string;
  name: string;
}

/**
 * listMyTenants — surfaces which tenant(s) a logged-in user belongs to, so
 * the frontend (PeriodoSelector.tsx) can offer a dropdown of names instead
 * of making every role paste a raw tenant UUID. Mirrors the exact
 * visibility rule tenant-access.ts's assertTenantAccess already encodes:
 * admin/colaborador see every tenant REGARDLESS of active (a single
 * estudio's staff), cliente only sees tenants they have a
 * user_tenant_access row for AND that are active (a disabled tenant already
 * blocks a cliente via assertTenantAccess, so there's no point listing it
 * here only to have it rejected on the next request).
 */
export async function listMyTenants(pool: Pool, user: AuthenticatedUser): Promise<MyTenantRow[]> {
  if (user.role === 'admin' || user.role === 'colaborador') {
    const { rows } = await pool.query<MyTenantRow>('SELECT id, name FROM tenants ORDER BY name ASC');
    return rows;
  }

  const { rows } = await pool.query<MyTenantRow>(
    `SELECT t.id, t.name FROM tenants t
     JOIN user_tenant_access uta ON uta.tenant_id = t.id
     WHERE uta.user_id = $1 AND t.active = true
     ORDER BY t.name ASC`,
    [user.id],
  );
  return rows;
}
