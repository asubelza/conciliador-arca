import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { assertTenantAccess } from './tenant-access';
import { createTestUser, deleteTestUser, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

describe('T37: assertTenantAccess (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('admin always passes, for any tenant id (even one that does not exist)', async () => {
    const { id, email } = await createTestUser(pool, { role: 'admin' });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'admin' }, randomUUID());
      expect(result).toBeUndefined();
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('colaborador always passes, for any tenant id', async () => {
    const { id, email } = await createTestUser(pool, { role: 'colaborador' });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'colaborador' }, randomUUID());
      expect(result).toBeUndefined();
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('cliente with a user_tenant_access row for that tenant passes', async () => {
    const tenantId = await createTestTenant(pool);
    const { id, email } = await createTestUser(pool, { role: 'cliente' });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, tenantId]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente' }, tenantId);
      expect(result).toBeUndefined();
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
    }
  });

  it('cliente with NO user_tenant_access row for that tenant gets a 403, not a 404 (never confirms/denies existence)', async () => {
    const tenantId = await createTestTenant(pool);
    const { id, email } = await createTestUser(pool, { role: 'cliente' });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente' }, tenantId);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
    }
  });

  it('cliente with access to a DIFFERENT tenant is still rejected for this one', async () => {
    const ownTenantId = await createTestTenant(pool);
    const otherTenantId = await createTestTenant(pool);
    const { id, email } = await createTestUser(pool, { role: 'cliente' });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, ownTenantId]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente' }, otherTenantId);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, ownTenantId);
      await deleteTestTenant(pool, otherTenantId);
    }
  });
});
