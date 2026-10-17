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
 * transaction. sendInviteEmail() is called AFTER that transaction commits
 * — it never throws (see invite-email.ts), so a Resend outage can't roll
 * back or block the account that's already committed; invite_email_sent
 * on the result lets the admin know if it actually went out.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { hashPassword } from './password';
import { createInviteToken, type InviteToken } from './invite-tokens';
import { sendInviteEmail } from './invite-email';
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
  invite_email_sent: boolean;
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
  let user: { id: string; email: string; role: UserRole; display_name: string | null; is_active: boolean; created_at: string };
  let invite: InviteToken;
  try {
    await client.query('BEGIN');

    const throwawayPasswordHash = await hashPassword(randomUUID());
    const { rows } = await client.query<typeof user>(
      `INSERT INTO users (email, password_hash, role, display_name, is_active)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, email, role, display_name, is_active, created_at`,
      [input.email, throwawayPasswordHash, input.role, input.display_name],
    );
    user = rows[0];

    if (input.role === 'cliente') {
      for (const tenantId of input.tenant_ids) {
        await client.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [user.id, tenantId]);
      }
    }

    invite = await createInviteToken(client, user.id);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const emailResult = await sendInviteEmail(user.email, user.display_name, invite.rawToken);
  return { ...user, invite, invite_email_sent: emailResult.sent };
}

/**
 * Resends the invite — invalidates any still-valid invite for this user
 * (createInviteToken's own job) and mints/sends a fresh one. Admin-only,
 * refused for an already-active user (nothing to invite them to anymore).
 */
export async function resendInvite(
  pool: Pool,
  userId: string,
): Promise<{ email: string; invite_email_sent: boolean } | 'NOT_FOUND' | 'ALREADY_ACTIVE'> {
  const client = await pool.connect();
  let user: { email: string; display_name: string | null } | undefined;
  let invite: InviteToken | undefined;
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ email: string; display_name: string | null; is_active: boolean }>(
      'SELECT email, display_name, is_active FROM users WHERE id = $1',
      [userId],
    );
    const found = rows[0];
    if (!found) {
      await client.query('ROLLBACK');
      return 'NOT_FOUND';
    }
    if (found.is_active) {
      await client.query('ROLLBACK');
      return 'ALREADY_ACTIVE';
    }
    user = { email: found.email, display_name: found.display_name };

    invite = await createInviteToken(client, userId);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const emailResult = await sendInviteEmail(user.email, user.display_name, invite.rawToken);
  return { email: user.email, invite_email_sent: emailResult.sent };
}

export type SetUserActiveResult = { id: string; is_active: boolean } | 'NOT_FOUND' | 'NEVER_ONBOARDED';

/**
 * Activating (isActive=true) is refused with NEVER_ONBOARDED for a user
 * who has at least one invite on record but has never genuinely ACCEPTED
 * one (`user_invites.accepted_at IS NULL` on every row) — i.e. created
 * through createUser()'s invite flow and never completed it. Their
 * password_hash is still createUser()'s throwaway hash (nobody knows it),
 * and accept-invite.service.ts's claimInvite() (PR3) requires
 * is_active=false to claim ANY invite — so activating first would make the
 * account unrecoverable without deactivating it again first.
 *
 * Checked against `accepted_at` (026), NOT `consumed_at` (025):
 * invite-tokens.ts's createInviteToken() also sets consumed_at on a
 * still-valid PRIOR invite purely to invalidate it when a fresh one is
 * issued (e.g. a resend) — that is not acceptance. `accepted_at` is only
 * ever set by claimInvite's own atomic UPDATE on a genuine accept, so a
 * resend can never make this guard think a never-accepted account is
 * fine to activate.
 *
 * A user with ZERO invite rows (created directly — the hand-seeded
 * admin@admin.com/test@test.com accounts, or any createTestUser() test
 * fixture) was never put through this flow at all and is unaffected.
 * Deactivating (isActive=false), and reactivating a user who has
 * genuinely accepted at least once, have no such restriction.
 */
async function updateIsActive(pool: Pool, userId: string, isActive: boolean): Promise<{ id: string; is_active: boolean } | undefined> {
  const { rows } = await pool.query<{ id: string; is_active: boolean }>(
    'UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id, is_active',
    [isActive, userId],
  );
  return rows[0];
}

export async function setUserActive(pool: Pool, userId: string, isActive: boolean): Promise<SetUserActiveResult> {
  if (!isActive) {
    return (await updateIsActive(pool, userId, false)) ?? 'NOT_FOUND';
  }

  const { rows: checkRows } = await pool.query<{ id: string; has_any_invite: boolean; has_accepted_invite: boolean }>(
    `SELECT u.id,
            EXISTS (SELECT 1 FROM user_invites WHERE user_id = u.id) AS has_any_invite,
            EXISTS (SELECT 1 FROM user_invites WHERE user_id = u.id AND accepted_at IS NOT NULL) AS has_accepted_invite
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  const check = checkRows[0];
  if (!check) return 'NOT_FOUND';
  if (check.has_any_invite && !check.has_accepted_invite) return 'NEVER_ONBOARDED';

  // No `?? 'NOT_FOUND'` fallback here, unlike the deactivate branch above:
  // the check above already confirmed this row exists, and nothing in this
  // codebase can delete a user (018_init_users_and_roles.sql's own
  // "deactivate, never delete" posture) — a fallback for that gap would be
  // untested dead code for a state that can't occur.
  return (await updateIsActive(pool, userId, true))!;
}
