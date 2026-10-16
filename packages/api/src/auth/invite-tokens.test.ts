import { createHash } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { createInviteToken, hashInviteToken } from './invite-tokens';
import { createTestUser, deleteTestUser } from '../test-support/pg-test-helpers';

/**
 * Backoffice self-service (invitación por email): integration coverage for
 * createInviteToken() against the real test Postgres (025_init_user_invites.sql)
 * — never mocks the DB, same convention as the rest of this repo's *.test.ts.
 */
describe('invite-tokens: createInviteToken / hashInviteToken', () => {
  let pool: Pool;
  let client: PoolClient;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const user = await createTestUser(pool, { role: 'cliente' });
    userId = user.id;
    client = await pool.connect();
  });

  afterEach(async () => {
    client.release();
    await deleteTestUser(pool, userId);
  });

  it('creates a token row with a 7-day expiry, storing only the SHA-256 hash of the raw token', async () => {
    const { rawToken, expiresAt } = await createInviteToken(client, userId);

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);

    const { rows } = await pool.query<{ token_hash: string; expires_at: Date; consumed_at: Date | null }>(
      'SELECT token_hash, expires_at, consumed_at FROM user_invites WHERE user_id = $1',
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(rows[0].token_hash).toBe(hashInviteToken(rawToken));
    expect(rows[0].consumed_at).toBeNull();

    const daysUntilExpiry = (rows[0].expires_at.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(6.9);
    expect(daysUntilExpiry).toBeLessThan(7.1);
    expect(expiresAt.getTime()).toBe(rows[0].expires_at.getTime());
  });

  it('invalidates the previous still-valid invite (marks consumed_at) when a second one is created for the same user', async () => {
    const first = await createInviteToken(client, userId);
    const second = await createInviteToken(client, userId);

    expect(second.rawToken).not.toBe(first.rawToken);

    const { rows } = await pool.query<{ token_hash: string; consumed_at: Date | null }>(
      'SELECT token_hash, consumed_at FROM user_invites WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].token_hash).toBe(hashInviteToken(first.rawToken));
    expect(rows[0].consumed_at).not.toBeNull();
    expect(rows[1].token_hash).toBe(hashInviteToken(second.rawToken));
    expect(rows[1].consumed_at).toBeNull();
  });

  it('does not touch an already-consumed invite from a previous call when creating yet another one', async () => {
    const first = await createInviteToken(client, userId);
    await pool.query('UPDATE user_invites SET consumed_at = now() WHERE token_hash = $1', [hashInviteToken(first.rawToken)]);
    const { rows: beforeRows } = await pool.query<{ consumed_at: Date }>(
      'SELECT consumed_at FROM user_invites WHERE token_hash = $1',
      [hashInviteToken(first.rawToken)],
    );
    const consumedAtBefore = beforeRows[0].consumed_at.getTime();

    await createInviteToken(client, userId);

    const { rows: afterRows } = await pool.query<{ consumed_at: Date }>(
      'SELECT consumed_at FROM user_invites WHERE token_hash = $1',
      [hashInviteToken(first.rawToken)],
    );
    expect(afterRows[0].consumed_at.getTime()).toBe(consumedAtBefore);
  });
});
