/**
 * invite-tokens.ts — backoffice self-service (invitación por email): mint
 * and invalidate the single-use link a newly created user gets to set
 * their own password (see 025_init_user_invites.sql's module doc for the
 * token_hash/consumed_at design).
 *
 * Takes a PoolClient (not a Pool) so callers compose this inside their own
 * transaction — createUser() in users.service.ts inserts the user row,
 * calls this, and commits both in one BEGIN/COMMIT.
 */
import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';

const TOKEN_BYTES = 32;
const EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface InviteToken {
  rawToken: string;
  expiresAt: Date;
}

/** Exported for accept-invite.service.ts (PR3) to hash an incoming raw token before the WHERE token_hash = $1 lookup. */
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Invalidates any still-valid invite for `userId` (marks consumed_at),
 * then inserts a fresh one — at most one valid invite per user at a time.
 */
export async function createInviteToken(client: PoolClient, userId: string): Promise<InviteToken> {
  await client.query(
    `UPDATE user_invites SET consumed_at = now()
     WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [userId],
  );

  const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + EXPIRES_IN_MS);
  await client.query('INSERT INTO user_invites (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hashInviteToken(rawToken),
    expiresAt,
  ]);

  return { rawToken, expiresAt };
}
