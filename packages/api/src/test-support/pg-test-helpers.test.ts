/**
 * pg-test-helpers.test.ts — multi-estudio pivot (PR2 of 8, see
 * idempotent-coalescing-rivest.md): these helpers are what every other
 * integration test in this repo relies on to create a valid `tenants`/
 * `users` row now that `tenants.estudio_id` is NOT NULL (029/031). Covers
 * the new surface only — createTestTenant/createTestUser's pre-existing
 * behavior is already exercised indirectly by every other *.controller.test.ts
 * file.
 */
import { Pool } from 'pg';
import { verifyToken } from '../auth/jwt';
import {
  authHeaderFor,
  createTestEstudio,
  createTestTenant,
  createTestUser,
  deleteTestEstudio,
  deleteTestTenant,
  deleteTestUser,
} from './pg-test-helpers';

describe('pg-test-helpers: multi-estudio pivot', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('createTestEstudio', () => {
    it('creates a real estudios row and returns its id', async () => {
      const estudioId = await createTestEstudio(pool);
      const { rows } = await pool.query('SELECT name, active FROM estudios WHERE id = $1', [estudioId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Test Estudio', active: true });
      await deleteTestEstudio(pool, estudioId);
    });

    it('accepts a custom name', async () => {
      const estudioId = await createTestEstudio(pool, 'Custom Estudio Name');
      const { rows } = await pool.query('SELECT name FROM estudios WHERE id = $1', [estudioId]);
      expect(rows[0].name).toBe('Custom Estudio Name');
      await deleteTestEstudio(pool, estudioId);
    });
  });

  describe('createTestTenant: estudio_id defaulting', () => {
    it('defaults to a valid, shared estudio when estudioId is not passed', async () => {
      const tenantAId = await createTestTenant(pool, 'Tenant A');
      const tenantBId = await createTestTenant(pool, 'Tenant B');
      const { rows } = await pool.query(
        'SELECT id, estudio_id FROM tenants WHERE id IN ($1, $2)',
        [tenantAId, tenantBId],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].estudio_id).toBeTruthy();
      // Same per-file shared default estudio for both tenants.
      expect(rows[0].estudio_id).toBe(rows[1].estudio_id);
      await deleteTestTenant(pool, tenantAId);
      await deleteTestTenant(pool, tenantBId);
    });

    it('uses an explicitly passed estudioId instead of the shared default', async () => {
      const estudioId = await createTestEstudio(pool, 'Explicit Estudio');
      const tenantId = await createTestTenant(pool, 'Tenant with explicit estudio', undefined, estudioId);
      const { rows } = await pool.query('SELECT estudio_id FROM tenants WHERE id = $1', [tenantId]);
      expect(rows[0].estudio_id).toBe(estudioId);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    });
  });

  describe('createTestUser: estudioId default vs. explicit null', () => {
    it('defaults to the SAME shared estudio createTestTenant defaults to', async () => {
      const tenantId = await createTestTenant(pool, 'Tenant for shared-estudio check');
      const { id: userId } = await createTestUser(pool);
      const { rows: tenantRows } = await pool.query('SELECT estudio_id FROM tenants WHERE id = $1', [tenantId]);
      const { rows: userRows } = await pool.query('SELECT estudio_id FROM users WHERE id = $1', [userId]);
      expect(userRows[0].estudio_id).toBe(tenantRows[0].estudio_id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestUser(pool, userId);
    });

    it('respects an explicit estudioId string override', async () => {
      const estudioId = await createTestEstudio(pool, 'User Explicit Estudio');
      const { id: userId } = await createTestUser(pool, { estudioId });
      const { rows } = await pool.query('SELECT estudio_id FROM users WHERE id = $1', [userId]);
      expect(rows[0].estudio_id).toBe(estudioId);
      await deleteTestUser(pool, userId);
      await deleteTestEstudio(pool, estudioId);
    });

    it('respects an explicit estudioId: null (platform-staff user) instead of coercing to the default', async () => {
      const { id: userId } = await createTestUser(pool, { estudioId: null });
      const { rows } = await pool.query('SELECT estudio_id FROM users WHERE id = $1', [userId]);
      expect(rows[0].estudio_id).toBeNull();
      await deleteTestUser(pool, userId);
    });
  });

  describe('authHeaderFor: estudioId is now signed into the token (PR3)', () => {
    it('signs an explicit estudioId string into the token', () => {
      const header = authHeaderFor('admin', { estudioId: 'some-estudio-id' });
      const token = header.replace('Bearer ', '');
      const payload = verifyToken(token);
      expect(payload?.estudio_id).toBe('some-estudio-id');
    });

    it('signs an explicit estudioId: null (platform-staff) into the token, not coerced to a default', () => {
      const header = authHeaderFor('admin', { estudioId: null });
      const token = header.replace('Bearer ', '');
      const payload = verifyToken(token);
      expect(payload?.estudio_id).toBeNull();
    });

    it('defaults to a non-null, syntactically valid estudio_id when estudioId is omitted entirely', () => {
      // NOT a real `estudios` row (see authHeaderFor's own doc comment) —
      // just proves the omitted case still produces a token that passes
      // jwt.ts's strict estudio_id shape check.
      const header = authHeaderFor('admin');
      const token = header.replace('Bearer ', '');
      const payload = verifyToken(token);
      expect(payload).not.toBeNull();
      expect(typeof payload?.estudio_id).toBe('string');
    });
  });

  describe('deleteTestEstudio', () => {
    it('removes the estudios row', async () => {
      const estudioId = await createTestEstudio(pool, 'To Be Deleted');
      await deleteTestEstudio(pool, estudioId);
      const { rows } = await pool.query('SELECT id FROM estudios WHERE id = $1', [estudioId]);
      expect(rows).toHaveLength(0);
    });
  });
});
