import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createUser, listUsers, resendInvite, setUserActive } from './users.service';
import {
  createTestEstudio,
  createTestTenant,
  createTestUser,
  deleteTestEstudio,
  deleteTestTenant,
  deleteTestUser,
} from '../test-support/pg-test-helpers';

/**
 * Backoffice self-service (invitación por email): integration coverage for
 * users.service.ts against the real test Postgres — never mocks the DB,
 * same convention as the rest of this repo's *.test.ts.
 */
describe('users.service: createUser / listUsers / setUserActive', () => {
  let pool: Pool;
  let estudioId: string;
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];
  const createdEstudioIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Shared across every test below EXCEPT createUser's own dedicated
    // null/explicit-estudio tests, which create their own estudios (or
    // pass null) specifically to prove that handling — everything else
    // just needs ONE real, consistent estudio so listUsers/setUserActive/
    // resendInvite's new `estudio_id = $N` scoping matches the fixtures.
    estudioId = await createTestEstudio(pool, 'users.service.test shared estudio');
  });

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await deleteTestUser(pool, id);
    }
    for (const id of createdTenantIds.splice(0)) {
      await deleteTestTenant(pool, id);
    }
    // users.estudio_id has no ON DELETE CASCADE from estudios — the user
    // row above must already be gone before this, same FK-ordering
    // discipline as deleteTestTenant's own comments in pg-test-helpers.ts.
    for (const id of createdEstudioIds.splice(0)) {
      await deleteTestEstudio(pool, id);
    }
  });

  afterAll(async () => {
    await deleteTestEstudio(pool, estudioId);
    await pool.end();
  });

  function email(prefix: string): string {
    return `${prefix}-${randomUUID()}@example.com`;
  }

  describe('createUser', () => {
    it('creates an admin with is_active=false, a throwaway password hash, and a fresh invite token (invite_email_sent:false — no SMTP_USER/SMTP_PASSWORD/APP_BASE_URL in this test env, documents the graceful-degradation contract from invite-email.ts)', async () => {
      const created = await createUser(pool, { email: email('admin'), role: 'admin', display_name: 'Admin User', tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);

      expect(created.is_active).toBe(false);
      expect(created.display_name).toBe('Admin User');
      expect(created.invite.rawToken).toMatch(/^[0-9a-f]{64}$/);
      expect(created.invite_email_sent).toBe(false);

      const { rows } = await pool.query<{ password_hash: string; is_active: boolean }>(
        'SELECT password_hash, is_active FROM users WHERE id = $1',
        [created.id],
      );
      expect(rows[0].is_active).toBe(false);
      expect(rows[0].password_hash).not.toBe('');

      const { rows: inviteRows } = await pool.query('SELECT id FROM user_invites WHERE user_id = $1', [created.id]);
      expect(inviteRows).toHaveLength(1);
    });

    it('creates a cliente with the given tenant_ids written to user_tenant_access', async () => {
      const tenantId = await createTestTenant(pool, 'users.service.test tenant');
      createdTenantIds.push(tenantId);

      const created = await createUser(pool, { email: email('cliente'), role: 'cliente', display_name: null, tenant_ids: [tenantId] }, estudioId);
      createdUserIds.push(created.id);

      const { rows } = await pool.query('SELECT tenant_id FROM user_tenant_access WHERE user_id = $1', [created.id]);
      expect(rows).toEqual([{ tenant_id: tenantId }]);
    });

    it('creates admin/colaborador with zero user_tenant_access rows', async () => {
      const created = await createUser(pool, { email: email('colab'), role: 'colaborador', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);

      const { rows } = await pool.query('SELECT tenant_id FROM user_tenant_access WHERE user_id = $1', [created.id]);
      expect(rows).toHaveLength(0);
    });

    it('rejects a duplicate email with the raw Postgres unique-violation error (controller translates it to 409)', async () => {
      const duplicateEmail = email('dup');
      const first = await createUser(pool, { email: duplicateEmail, role: 'admin', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(first.id);

      await expect(
        createUser(pool, { email: duplicateEmail, role: 'admin', display_name: null, tenant_ids: [] }, estudioId),
      ).rejects.toMatchObject({ code: '23505' });

      // The failed attempt must not leave a half-written user_tenant_access/invite behind.
      const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [duplicateEmail]);
      expect(rows).toHaveLength(1);
    });

    it("multi-estudio pivot: the new user inherits the creating admin's own estudio_id, never NULL by accident", async () => {
      const estudioId = await createTestEstudio(pool, 'users.service.test estudio');
      createdEstudioIds.push(estudioId);

      const created = await createUser(
        pool,
        { email: email('estudio-scoped'), role: 'colaborador', display_name: null, tenant_ids: [] },
        estudioId,
      );
      createdUserIds.push(created.id);

      const { rows } = await pool.query<{ estudio_id: string | null }>('SELECT estudio_id FROM users WHERE id = $1', [
        created.id,
      ]);
      expect(rows[0].estudio_id).toBe(estudioId);
    });

    it('a platform-level creator (estudio_id null) creates a platform-level user — not silently assigned to a random estudio', async () => {
      const created = await createUser(
        pool,
        { email: email('platform-created'), role: 'admin', display_name: null, tenant_ids: [] },
        null,
      );
      createdUserIds.push(created.id);

      const { rows } = await pool.query<{ estudio_id: string | null }>('SELECT estudio_id FROM users WHERE id = $1', [
        created.id,
      ]);
      expect(rows[0].estudio_id).toBeNull();
    });
  });

  describe('listUsers', () => {
    it('includes a created admin with an empty tenant_ids array', async () => {
      const created = await createUser(pool, { email: email('list-admin'), role: 'admin', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);

      const rows = await listUsers(pool, estudioId);
      const found = rows.find((r) => r.id === created.id);
      expect(found).toBeDefined();
      expect(found?.tenant_ids).toEqual([]);
    });

    it('includes a created cliente with its tenant_ids populated', async () => {
      const tenantId = await createTestTenant(pool, 'users.service.test list tenant');
      createdTenantIds.push(tenantId);
      const created = await createUser(pool, { email: email('list-cliente'), role: 'cliente', display_name: null, tenant_ids: [tenantId] }, estudioId);
      createdUserIds.push(created.id);

      const rows = await listUsers(pool, estudioId);
      const found = rows.find((r) => r.id === created.id);
      expect(found?.tenant_ids).toEqual([tenantId]);
    });

    it("multi-estudio pivot: never includes another estudio's users", async () => {
      const otherEstudioId = await createTestEstudio(pool, 'users.service.test other estudio');
      createdEstudioIds.push(otherEstudioId);
      const created = await createUser(
        pool,
        { email: email('other-estudio'), role: 'admin', display_name: null, tenant_ids: [] },
        otherEstudioId,
      );
      createdUserIds.push(created.id);

      const rows = await listUsers(pool, estudioId);
      expect(rows.some((r) => r.id === created.id)).toBe(false);
    });
  });

  describe('setUserActive', () => {
    // createTestUser() never creates a user_invites row — this also
    // documents that a user with zero invite rows (e.g. a hand-seeded
    // account like admin@admin.com, or any createTestUser() fixture) is
    // never treated as NEVER_ONBOARDED, since that guard only applies to
    // users who went through createUser()'s invite flow at all.
    it('activates a user and returns the updated row', async () => {
      const user = await createTestUser(pool, { isActive: false, estudioId });
      createdUserIds.push(user.id);

      const updated = await setUserActive(pool, user.id, true, estudioId);
      expect(updated).toEqual({ id: user.id, is_active: true });
    });

    it('deactivates a user', async () => {
      const user = await createTestUser(pool, { isActive: true, estudioId });
      createdUserIds.push(user.id);

      const updated = await setUserActive(pool, user.id, false, estudioId);
      expect(updated).toEqual({ id: user.id, is_active: false });
    });

    it("returns 'NOT_FOUND' for an unknown user id", async () => {
      const updated = await setUserActive(pool, randomUUID(), true, estudioId);
      expect(updated).toBe('NOT_FOUND');
    });

    it("refuses to activate a user created via createUser() who never accepted their invite ('NEVER_ONBOARDED'), without touching is_active", async () => {
      const created = await createUser(pool, { email: email('never-onboarded'), role: 'admin', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);

      const updated = await setUserActive(pool, created.id, true, estudioId);
      expect(updated).toBe('NEVER_ONBOARDED');

      const { rows } = await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [created.id]);
      expect(rows[0].is_active).toBe(false);
    });

    it('allows reactivating a user who genuinely accepted an invite at least once, even after being deactivated', async () => {
      const created = await createUser(pool, { email: email('reactivate'), role: 'admin', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);
      // Simulates having gone through accept-invite (PR3) at least once —
      // that service doesn't exist yet on this branch, so this marks the
      // same user_invites.accepted_at (+ consumed_at) columns it would have
      // set on a genuine accept.
      await pool.query('UPDATE user_invites SET consumed_at = now(), accepted_at = now() WHERE user_id = $1', [created.id]);
      await setUserActive(pool, created.id, false, estudioId); // e.g. offboarded, then reconsidered

      const updated = await setUserActive(pool, created.id, true, estudioId);
      expect(updated).toEqual({ id: created.id, is_active: true });
    });

    it("regression: resendInvite() must NOT look like acceptance — still 'NEVER_ONBOARDED' even though it sets consumed_at on the invalidated first invite", async () => {
      const created = await createUser(pool, { email: email('resent-not-accepted'), role: 'admin', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);

      await resendInvite(pool, created.id, estudioId);

      const { rows: consumedRows } = await pool.query<{ consumed_at: Date | null }>(
        'SELECT consumed_at FROM user_invites WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
        [created.id],
      );
      expect(consumedRows[0].consumed_at).not.toBeNull(); // the invalidated first invite

      const updated = await setUserActive(pool, created.id, true, estudioId);
      expect(updated).toBe('NEVER_ONBOARDED');
    });

    it("multi-estudio pivot: returns 'NOT_FOUND' for a user that belongs to a different estudio, never mutating it", async () => {
      const otherEstudioId = await createTestEstudio(pool, 'users.service.test other estudio');
      createdEstudioIds.push(otherEstudioId);
      const user = await createTestUser(pool, { isActive: true, estudioId: otherEstudioId });
      createdUserIds.push(user.id);

      const updated = await setUserActive(pool, user.id, false, estudioId);
      expect(updated).toBe('NOT_FOUND');

      const { rows } = await pool.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [user.id]);
      expect(rows[0].is_active).toBe(true);
    });
  });

  describe('resendInvite', () => {
    it('mints a fresh invite for an inactive user, invalidating the previous one', async () => {
      const created = await createUser(pool, { email: email('resend'), role: 'admin', display_name: null, tenant_ids: [] }, estudioId);
      createdUserIds.push(created.id);

      const result = await resendInvite(pool, created.id, estudioId);
      expect(result).toEqual({ email: created.email, invite_email_sent: false });

      const { rows } = await pool.query<{ consumed_at: Date | null }>(
        'SELECT consumed_at FROM user_invites WHERE user_id = $1 ORDER BY created_at ASC',
        [created.id],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].consumed_at).not.toBeNull(); // the invite createUser() already made
      expect(rows[1].consumed_at).toBeNull(); // the fresh one from resendInvite()
    });

    it("returns 'ALREADY_ACTIVE' for an active user, without touching user_invites", async () => {
      const user = await createTestUser(pool, { isActive: true, estudioId });
      createdUserIds.push(user.id);

      const result = await resendInvite(pool, user.id, estudioId);
      expect(result).toBe('ALREADY_ACTIVE');

      const { rows } = await pool.query('SELECT id FROM user_invites WHERE user_id = $1', [user.id]);
      expect(rows).toHaveLength(0);
    });

    it("returns 'NOT_FOUND' for an unknown user id", async () => {
      const result = await resendInvite(pool, randomUUID(), estudioId);
      expect(result).toBe('NOT_FOUND');
    });

    it("multi-estudio pivot: returns 'NOT_FOUND' for a user that belongs to a different estudio, never sending an invite", async () => {
      const otherEstudioId = await createTestEstudio(pool, 'users.service.test other estudio');
      createdEstudioIds.push(otherEstudioId);
      const user = await createTestUser(pool, { isActive: false, estudioId: otherEstudioId });
      createdUserIds.push(user.id);

      const result = await resendInvite(pool, user.id, estudioId);
      expect(result).toBe('NOT_FOUND');

      const { rows } = await pool.query('SELECT id FROM user_invites WHERE user_id = $1', [user.id]);
      expect(rows).toHaveLength(0);
    });
  });
});
