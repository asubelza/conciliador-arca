import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { acceptInvite, peekInvite } from './accept-invite.service';
import { hashInviteToken } from './invite-tokens';
import { verifyPassword } from './password';
import { verifyToken } from './jwt';
import { createTestUser, deleteTestUser, createTestEstudio, deleteTestEstudio } from '../test-support/pg-test-helpers';

/**
 * accept-invite.service.test.ts — integration coverage for acceptInvite()/
 * peekInvite() against the real test Postgres — never mocks the DB, same
 * convention as the rest of this repo's *.test.ts.
 */
describe('accept-invite.service: acceptInvite / peekInvite', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const user = await createTestUser(pool, { role: 'cliente', isActive: false, email: `accept-invite-${randomBytes(4).toString('hex')}@example.com` });
    userId = user.id;
  });

  afterEach(async () => {
    await deleteTestUser(pool, userId);
  });

  async function insertInvite(overrides: { expiresInMs?: number; consumedAt?: Date; userId?: string } = {}): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (overrides.expiresInMs ?? 7 * 24 * 60 * 60 * 1000));
    await pool.query('INSERT INTO user_invites (user_id, token_hash, expires_at, consumed_at) VALUES ($1, $2, $3, $4)', [
      overrides.userId ?? userId,
      hashInviteToken(rawToken),
      expiresAt,
      overrides.consumedAt ?? null,
    ]);
    return rawToken;
  }

  describe('acceptInvite', () => {
    it('activates the user, sets a real password, consumes the invite, and returns a working LoginResult', async () => {
      const rawToken = await insertInvite();

      const result = await acceptInvite(pool, rawToken, 'brand-new-password');

      expect('code' in result).toBe(false);
      if ('code' in result) throw new Error('unreachable');
      expect(result.user).toMatchObject({ id: userId, role: 'cliente' });
      const decoded = verifyToken(result.token);
      expect(decoded?.sub).toBe(userId);

      const { rows } = await pool.query<{ password_hash: string; is_active: boolean }>(
        'SELECT password_hash, is_active FROM users WHERE id = $1',
        [userId],
      );
      expect(rows[0].is_active).toBe(true);
      expect(await verifyPassword('brand-new-password', rows[0].password_hash)).toBe(true);

      const { rows: inviteRows } = await pool.query<{ consumed_at: Date | null; accepted_at: Date | null }>(
        'SELECT consumed_at, accepted_at FROM user_invites WHERE token_hash = $1',
        [hashInviteToken(rawToken)],
      );
      expect(inviteRows[0].consumed_at).not.toBeNull();
      // accepted_at (026) is distinct from consumed_at: it's only ever set
      // by a genuine accept here, never by createInviteToken()'s own
      // invalidate-on-resend UPDATE — see users.service.ts's setUserActive
      // NEVER_ONBOARDED guard, which relies on exactly this distinction.
      expect(inviteRows[0].accepted_at).not.toBeNull();
    });

    it("estudio_id round-trips through the returned LoginResult, matching the invited user's own estudio_id", async () => {
      const estudioId = await createTestEstudio(pool);
      const scopedUser = await createTestUser(pool, {
        role: 'cliente',
        isActive: false,
        estudioId,
        email: `accept-invite-estudio-${randomBytes(4).toString('hex')}@example.com`,
      });
      try {
        const rawToken = await insertInvite({ userId: scopedUser.id });
        const result = await acceptInvite(pool, rawToken, 'brand-new-password');
        expect('code' in result).toBe(false);
        if ('code' in result) throw new Error('unreachable');
        expect(result.user.estudio_id).toBe(estudioId);
        const decoded = verifyToken(result.token);
        expect(decoded?.estudio_id).toBe(estudioId);
      } finally {
        await deleteTestUser(pool, scopedUser.id);
        await deleteTestEstudio(pool, estudioId);
      }
    });

    it('estudio_id round-trips as null for a platform-tier invited user', async () => {
      const scopedUser = await createTestUser(pool, {
        role: 'admin',
        isActive: false,
        estudioId: null,
        email: `accept-invite-platform-${randomBytes(4).toString('hex')}@example.com`,
      });
      try {
        const rawToken = await insertInvite({ userId: scopedUser.id });
        const result = await acceptInvite(pool, rawToken, 'brand-new-password');
        expect('code' in result).toBe(false);
        if ('code' in result) throw new Error('unreachable');
        expect(result.user.estudio_id).toBeNull();
        const decoded = verifyToken(result.token);
        expect(decoded?.estudio_id).toBeNull();
      } finally {
        await deleteTestUser(pool, scopedUser.id);
      }
    });

    it('returns INVITE_NOT_FOUND for a well-formed but unknown token, without changing the user', async () => {
      const result = await acceptInvite(pool, randomBytes(32).toString('hex'), 'whatever-password');
      expect(result).toMatchObject({ code: 'INVITE_NOT_FOUND', status: 404 });

      const { rows } = await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [userId]);
      expect(rows[0].is_active).toBe(false);
    });

    it('returns INVITE_EXPIRED for an expired invite, without activating the user', async () => {
      const rawToken = await insertInvite({ expiresInMs: -1000 });

      const result = await acceptInvite(pool, rawToken, 'whatever-password');
      expect(result).toMatchObject({ code: 'INVITE_EXPIRED', status: 410 });

      const { rows } = await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [userId]);
      expect(rows[0].is_active).toBe(false);
    });

    it('returns INVITE_ALREADY_USED for an already-consumed invite', async () => {
      const rawToken = await insertInvite({ consumedAt: new Date() });

      const result = await acceptInvite(pool, rawToken, 'whatever-password');
      expect(result).toMatchObject({ code: 'INVITE_ALREADY_USED', status: 410 });
    });

    it('a second accept with the same token after a successful one returns INVITE_ALREADY_USED (single-use)', async () => {
      const rawToken = await insertInvite();
      await acceptInvite(pool, rawToken, 'first-password');

      const result = await acceptInvite(pool, rawToken, 'second-password');
      expect(result).toMatchObject({ code: 'INVITE_ALREADY_USED', status: 410 });
    });

    it('returns INVITE_ALREADY_USED for a still-unconsumed invite whose user was already activated through another path (e.g. an admin PATCH), and does not overwrite the password', async () => {
      const rawToken = await insertInvite(); // consumed_at still null
      await pool.query('UPDATE users SET is_active = true WHERE id = $1', [userId]);
      const { rows: before } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);

      const result = await acceptInvite(pool, rawToken, 'attacker-chosen-password');
      expect(result).toMatchObject({ code: 'INVITE_ALREADY_USED', status: 410 });

      const { rows: after } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
      expect(after[0].password_hash).toBe(before[0].password_hash);
    });

    it('only one of two concurrent accepts for the same token succeeds (no TOCTOU race)', async () => {
      const rawToken = await insertInvite();

      const [first, second] = await Promise.all([
        acceptInvite(pool, rawToken, 'password-one'),
        acceptInvite(pool, rawToken, 'password-two'),
      ]);

      const results = [first, second];
      const successes = results.filter((r) => !('code' in r));
      const failures = results.filter((r) => 'code' in r);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ code: 'INVITE_ALREADY_USED' });
    });
  });

  describe('peekInvite', () => {
    it('returns the invited email/display_name for a valid invite, without consuming it', async () => {
      const rawToken = await insertInvite();

      const result = await peekInvite(pool, rawToken);
      expect('code' in result).toBe(false);

      const { rows } = await pool.query<{ consumed_at: Date | null }>(
        'SELECT consumed_at FROM user_invites WHERE token_hash = $1',
        [hashInviteToken(rawToken)],
      );
      expect(rows[0].consumed_at).toBeNull();
    });

    it('returns INVITE_NOT_FOUND for an unknown token', async () => {
      const result = await peekInvite(pool, randomBytes(32).toString('hex'));
      expect(result).toMatchObject({ code: 'INVITE_NOT_FOUND', status: 404 });
    });

    it('returns INVITE_EXPIRED for an expired invite', async () => {
      const rawToken = await insertInvite({ expiresInMs: -1000 });
      const result = await peekInvite(pool, rawToken);
      expect(result).toMatchObject({ code: 'INVITE_EXPIRED', status: 410 });
    });

    it('returns INVITE_ALREADY_USED for a still-unconsumed invite whose user was already activated through another path', async () => {
      const rawToken = await insertInvite();
      await pool.query('UPDATE users SET is_active = true WHERE id = $1', [userId]);

      const result = await peekInvite(pool, rawToken);
      expect(result).toMatchObject({ code: 'INVITE_ALREADY_USED', status: 410 });
    });
  });
});
