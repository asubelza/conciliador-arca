import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createUser, listUsers, setUserActive } from './users.service';
import { createTestTenant, createTestUser, deleteTestTenant, deleteTestUser } from '../test-support/pg-test-helpers';

/**
 * Backoffice self-service (invitación por email): integration coverage for
 * users.service.ts against the real test Postgres — never mocks the DB,
 * same convention as the rest of this repo's *.test.ts.
 */
describe('users.service: createUser / listUsers / setUserActive', () => {
  let pool: Pool;
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await deleteTestUser(pool, id);
    }
    for (const id of createdTenantIds.splice(0)) {
      await deleteTestTenant(pool, id);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  function email(prefix: string): string {
    return `${prefix}-${randomUUID()}@example.com`;
  }

  describe('createUser', () => {
    it('creates an admin with is_active=false, a throwaway password hash, and a fresh invite token', async () => {
      const created = await createUser(pool, { email: email('admin'), role: 'admin', display_name: 'Admin User', tenant_ids: [] });
      createdUserIds.push(created.id);

      expect(created.is_active).toBe(false);
      expect(created.display_name).toBe('Admin User');
      expect(created.invite.rawToken).toMatch(/^[0-9a-f]{64}$/);

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

      const created = await createUser(pool, { email: email('cliente'), role: 'cliente', display_name: null, tenant_ids: [tenantId] });
      createdUserIds.push(created.id);

      const { rows } = await pool.query('SELECT tenant_id FROM user_tenant_access WHERE user_id = $1', [created.id]);
      expect(rows).toEqual([{ tenant_id: tenantId }]);
    });

    it('creates admin/colaborador with zero user_tenant_access rows', async () => {
      const created = await createUser(pool, { email: email('colab'), role: 'colaborador', display_name: null, tenant_ids: [] });
      createdUserIds.push(created.id);

      const { rows } = await pool.query('SELECT tenant_id FROM user_tenant_access WHERE user_id = $1', [created.id]);
      expect(rows).toHaveLength(0);
    });

    it('rejects a duplicate email with the raw Postgres unique-violation error (controller translates it to 409)', async () => {
      const duplicateEmail = email('dup');
      const first = await createUser(pool, { email: duplicateEmail, role: 'admin', display_name: null, tenant_ids: [] });
      createdUserIds.push(first.id);

      await expect(
        createUser(pool, { email: duplicateEmail, role: 'admin', display_name: null, tenant_ids: [] }),
      ).rejects.toMatchObject({ code: '23505' });

      // The failed attempt must not leave a half-written user_tenant_access/invite behind.
      const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [duplicateEmail]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('listUsers', () => {
    it('includes a created admin with an empty tenant_ids array', async () => {
      const created = await createUser(pool, { email: email('list-admin'), role: 'admin', display_name: null, tenant_ids: [] });
      createdUserIds.push(created.id);

      const rows = await listUsers(pool);
      const found = rows.find((r) => r.id === created.id);
      expect(found).toBeDefined();
      expect(found?.tenant_ids).toEqual([]);
    });

    it('includes a created cliente with its tenant_ids populated', async () => {
      const tenantId = await createTestTenant(pool, 'users.service.test list tenant');
      createdTenantIds.push(tenantId);
      const created = await createUser(pool, { email: email('list-cliente'), role: 'cliente', display_name: null, tenant_ids: [tenantId] });
      createdUserIds.push(created.id);

      const rows = await listUsers(pool);
      const found = rows.find((r) => r.id === created.id);
      expect(found?.tenant_ids).toEqual([tenantId]);
    });
  });

  describe('setUserActive', () => {
    it('activates a user and returns the updated row', async () => {
      const user = await createTestUser(pool, { isActive: false });
      createdUserIds.push(user.id);

      const updated = await setUserActive(pool, user.id, true);
      expect(updated).toEqual({ id: user.id, is_active: true });
    });

    it('deactivates a user', async () => {
      const user = await createTestUser(pool, { isActive: true });
      createdUserIds.push(user.id);

      const updated = await setUserActive(pool, user.id, false);
      expect(updated).toEqual({ id: user.id, is_active: false });
    });

    it('returns null for an unknown user id', async () => {
      const updated = await setUserActive(pool, randomUUID(), true);
      expect(updated).toBeNull();
    });
  });
});
