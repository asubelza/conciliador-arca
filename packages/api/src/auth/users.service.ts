/**
 * users.service.ts — backoffice self-service: admin-only user CRUD plus
 * the write side of the email-invite flow (see invite-tokens.ts and
 * 025_init_user_invites.sql for the token design).
 *
 * createUser() inserts the user row with is_active=false and a throwaway
 * password_hash (hashPassword(randomUUID()) — nobody ever learns this
 * value) rather than a NULL/sentinel column, because auth.service.ts's
 * login() already short-circuits with INVALID_CREDENTIALS the moment
 * !user.is_active, before ever reaching verifyPassword — so this hash is
 * never evaluated. The user row, its user_tenant_access rows (role
 * 'cliente' only), and the invite token are all written in one
 * transaction. Sending the actual invite email is PR3's job
 * (invite-email.ts), called by the controller after this resolves — a
 * Resend outage must never roll back or block account creation.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { hashPassword } from './password';
import { createInviteToken, type InviteToken } from './invite-tokens';
import type { UserRole } from './users-types';
import type { CreateUserRequestBody } from './users-validation';

export interface UserListRow {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  tenant_ids: string[];
}

export interface CreatedUser {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  invite: InviteToken;
}

export async function listUsers(pool: Pool): Promise<UserListRow[]> {
  const { rows } = await pool.query<UserListRow>(
    `SELECT u.id, u.email, u.role, u.display_name, u.is_active, u.created_at,
            COALESCE(array_agg(uta.tenant_id) FILTER (WHERE uta.tenant_id IS NOT NULL), '{}') AS tenant_ids
     FROM users u
     LEFT JOIN user_tenant_access uta ON uta.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );
  return rows;
}

/**
 * Throws the raw pg error (e.g. the users.email UNIQUE violation, code
 * 23505) on conflict — same "let the caller translate the DB error"
 * posture as periodos.controller.ts's own isUniqueViolation() check;
 * translating it to an HTTP response is the controller's job.
 */
export async function createUser(pool: Pool, input: CreateUserRequestBody): Promise<CreatedUser> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const throwawayPasswordHash = await hashPassword(randomUUID());
    const { rows } = await client.query<{
      id: string;
      email: string;
      role: UserRole;
      display_name: string | null;
      is_active: boolean;
      created_at: string;
    }>(
      `INSERT INTO users (email, password_hash, role, display_name, is_active)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, email, role, display_name, is_active, created_at`,
      [input.email, throwawayPasswordHash, input.role, input.display_name],
    );
    const user = rows[0];

    if (input.role === 'cliente') {
      for (const tenantId of input.tenant_ids) {
        await client.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [user.id, tenantId]);
      }
    }

    const invite = await createInviteToken(client, user.id);

    await client.query('COMMIT');
    return { ...user, invite };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setUserActive(pool: Pool, userId: string, isActive: boolean): Promise<{ id: string; is_active: boolean } | null> {
  const { rows } = await pool.query<{ id: string; is_active: boolean }>(
    'UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id, is_active',
    [isActive, userId],
  );
  return rows[0] ?? null;
}
