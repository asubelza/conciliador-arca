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
  user: { id: string; email: string; role: UserRole; display_name: string | null; estudio_id: string | null };
}

const INVALID_CREDENTIALS: LoginFailure = {
  code: 'INVALID_CREDENTIALS',
  status: 401,
  error: 'email o contraseña inválidos',
};

export async function login(pool: Pool, email: string, password: string): Promise<LoginResult | LoginFailure> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, password_hash, role, display_name, is_active, estudio_id FROM users WHERE email = $1',
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

  const token = signToken({ sub: user.id, role: user.role, email: user.email, estudio_id: user.estudio_id });
  return {
    token,
    user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name, estudio_id: user.estudio_id },
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
 * visibility rule tenant-access.ts's assertTenantAccess already encodes,
 * now estudio-scoped (multi-estudio pivot): a platform-level staff user
 * (estudio_id === null) has no implicit access to any estudio's tenants, so
 * this returns an empty list for them with no query at all. Otherwise
 * admin/colaborador see every tenant WITHIN THEIR OWN estudio (REGARDLESS
 * of active), cliente only sees tenants they have a user_tenant_access row
 * for, that are active, AND that belong to their own estudio (defense-in-
 * depth — a cliente's tenant_ids should never cross estudios by
 * construction, but enforced here too, same as assertTenantAccess).
 */
export async function listMyTenants(pool: Pool, user: AuthenticatedUser): Promise<MyTenantRow[]> {
  if (user.estudio_id === null) {
    return [];
  }

  if (user.role === 'admin' || user.role === 'colaborador') {
    const { rows } = await pool.query<MyTenantRow>(
      'SELECT id, name FROM tenants WHERE estudio_id = $1 ORDER BY name ASC',
      [user.estudio_id],
    );
    return rows;
  }

  const { rows } = await pool.query<MyTenantRow>(
    `SELECT t.id, t.name FROM tenants t
     JOIN user_tenant_access uta ON uta.tenant_id = t.id
     WHERE uta.user_id = $1 AND t.active = true AND t.estudio_id = $2
     ORDER BY t.name ASC`,
    [user.id, user.estudio_id],
  );
  return rows;
}
