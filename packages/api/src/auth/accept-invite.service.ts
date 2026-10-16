/**
 * accept-invite.service.ts — backoffice self-service (invitación por
 * email): resolves a raw invite token to its user and, on accept, flips
 * is_active=true + sets the real password_hash + consumes the invite — all
 * in one transaction — then returns a real LoginResult (same shape as
 * auth.service.ts's login()) so the user is logged in immediately, no
 * separate login screen.
 *
 * Password-strength/token-shape checks already happened in
 * accept-invite-validation.ts before either exported function here is
 * called — these two only deal with invite *state* (not found/expired/
 * already used), same scope split as LoginFailure (auth.service.ts) vs.
 * validateLoginBody (auth-validation.ts).
 */
import type { Pool, PoolClient } from 'pg';
import { hashPassword } from './password';
import { signToken } from './jwt';
import { hashInviteToken } from './invite-tokens';
import type { LoginResult } from './auth.service';
import type { UserRole } from './users-types';

export type AcceptInviteFailure =
  | { code: 'INVITE_NOT_FOUND'; status: 404; error: string }
  | { code: 'INVITE_EXPIRED'; status: 410; error: string }
  | { code: 'INVITE_ALREADY_USED'; status: 410; error: string };

const INVITE_NOT_FOUND: AcceptInviteFailure = { code: 'INVITE_NOT_FOUND', status: 404, error: 'invitación no encontrada' };
const INVITE_EXPIRED: AcceptInviteFailure = { code: 'INVITE_EXPIRED', status: 410, error: 'la invitación venció' };
const INVITE_ALREADY_USED: AcceptInviteFailure = { code: 'INVITE_ALREADY_USED', status: 410, error: 'la invitación ya fue utilizada' };

interface InviteRow {
  id: string;
  user_id: string;
  expires_at: Date;
  consumed_at: Date | null;
  is_active: boolean;
  email: string;
  role: UserRole;
  display_name: string | null;
}

async function findInvite(client: Pool | PoolClient, rawToken: string): Promise<InviteRow | undefined> {
  const { rows } = await client.query<InviteRow>(
    `SELECT ui.id, ui.user_id, ui.expires_at, ui.consumed_at, u.is_active, u.email, u.role, u.display_name
     FROM user_invites ui
     JOIN users u ON u.id = ui.user_id
     WHERE ui.token_hash = $1`,
    [hashInviteToken(rawToken)],
  );
  return rows[0];
}

/**
 * `invite.is_active` (not just `consumed_at`) counts as already-used: a
 * user activated directly via PATCH /api/users/:id (setUserActive, which
 * never touches user_invites) still has an unconsumed, unexpired invite
 * sitting around — without this check, anyone who ever saw that original
 * invite link could still redeem it later to overwrite the password and
 * log in, even though the admin believed the account was already settled.
 * This read is also used by the race-free claim below only to classify
 * *why* a claim failed, never as the gate itself.
 */
function checkInviteState(invite: InviteRow | undefined): AcceptInviteFailure | undefined {
  if (!invite) return INVITE_NOT_FOUND;
  if (invite.consumed_at || invite.is_active) return INVITE_ALREADY_USED;
  if (invite.expires_at.getTime() < Date.now()) return INVITE_EXPIRED;
  return undefined;
}

/**
 * Atomically claims the invite: the UPDATE's own WHERE clause (not a
 * prior SELECT) is the real gate, so two concurrent accept-invite calls
 * for the same token can never both succeed — Postgres's row lock makes
 * the second UPDATE block until the first commits, then re-evaluate
 * `consumed_at IS NULL`/`is_active = false` against the now-updated row
 * and affect zero rows. A prior SELECT-then-UPDATE (what this used to do)
 * is exactly the TOCTOU shape that would let both callers pass the check
 * before either writes.
 */
async function claimInvite(client: PoolClient, rawToken: string): Promise<InviteRow | undefined> {
  const { rows } = await client.query<InviteRow>(
    `UPDATE user_invites ui
     SET consumed_at = now(), accepted_at = now()
     FROM users u
     WHERE ui.token_hash = $1
       AND u.id = ui.user_id
       AND ui.consumed_at IS NULL
       AND ui.expires_at > now()
       AND u.is_active = false
     RETURNING ui.id, ui.user_id, ui.expires_at, ui.consumed_at, u.is_active, u.email, u.role, u.display_name`,
    [hashInviteToken(rawToken)],
  );
  return rows[0];
}

export interface PeekedInvite {
  email: string;
  display_name: string | null;
}

/** Read-only lookup for GET /api/auth/invite/:token — lets the no-session set-password page show who it's for before the user submits anything. Never claims/consumes anything. */
export async function peekInvite(pool: Pool, rawToken: string): Promise<PeekedInvite | AcceptInviteFailure> {
  const invite = await findInvite(pool, rawToken);
  const failure = checkInviteState(invite);
  if (failure) return failure;
  return { email: invite!.email, display_name: invite!.display_name };
}

export async function acceptInvite(pool: Pool, rawToken: string, password: string): Promise<LoginResult | AcceptInviteFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimInvite(client, rawToken);
    if (!claimed) {
      await client.query('ROLLBACK');
      // The atomic gate above already decided this failed — this lookup
      // only produces an accurate error message (not found / expired /
      // already used), it plays no part in the actual claim.
      const invite = await findInvite(pool, rawToken);
      return checkInviteState(invite) ?? INVITE_ALREADY_USED;
    }

    const passwordHash = await hashPassword(password);
    await client.query('UPDATE users SET password_hash = $1, is_active = true, updated_at = now() WHERE id = $2', [
      passwordHash,
      claimed.user_id,
    ]);
    await client.query('COMMIT');

    const token = signToken({ sub: claimed.user_id, role: claimed.role, email: claimed.email });
    return { token, user: { id: claimed.user_id, email: claimed.email, role: claimed.role, display_name: claimed.display_name } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
