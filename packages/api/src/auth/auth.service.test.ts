import { Pool } from 'pg';
import { login, listMyTenants } from './auth.service';
import { verifyToken } from './jwt';
import { createTestUser, deleteTestUser, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

describe('T34/T35: login (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('a correct email/password issues a valid JWT and the right user shape', async () => {
    const { id, email, password } = await createTestUser(pool, { role: 'admin' });
    try {
      const result = await login(pool, email, password);
      if ('code' in result) throw new Error('expected success');
      expect(result.user).toEqual({ id, email, role: 'admin', display_name: null });

      const payload = verifyToken(result.token);
      expect(payload).toEqual({ sub: id, role: 'admin', email });
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('login is case-insensitive on email', async () => {
    // users.email is always stored lowercase (CHECK constraint, migration
    // 018) — createTestUser normalizes it on insert, same as any real
    // account-creation path must. What this test actually proves is that
    // login() ALSO normalizes its input, so logging in with the original
    // mixed-case string (as a person would type it) still matches the
    // normalized row.
    const originalMixedCase = `Mixed-Case-${Date.now()}@Example.com`;
    const { id, password } = await createTestUser(pool, { email: originalMixedCase });
    try {
      const result = await login(pool, originalMixedCase, password);
      expect('code' in result).toBe(false);
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('wrong password returns a generic 401, not a hint', async () => {
    const { id, email } = await createTestUser(pool, { password: 'the-real-one' });
    try {
      const result = await login(pool, email, 'wrong-password');
      expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, error: 'email o contraseña inválidos' });
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('unknown email returns the SAME generic 401 as a wrong password (never reveals which email exists)', async () => {
    const result = await login(pool, 'no-such-user@example.com', 'whatever');
    expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, error: 'email o contraseña inválidos' });
  });

  it('a deactivated (is_active=false) user cannot log in even with the correct password', async () => {
    const { id, email, password } = await createTestUser(pool, { isActive: false });
    try {
      const result = await login(pool, email, password);
      expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, error: 'email o contraseña inválidos' });
    } finally {
      await deleteTestUser(pool, id);
    }
  });
});

describe('tenant-discovery: listMyTenants (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('admin sees every tenant, including inactive ones', async () => {
    const activeTenantId = await createTestTenant(pool, 'Active Co');
    const inactiveTenantId = await createTestTenant(pool, 'Inactive Co');
    const { id, email } = await createTestUser(pool, { role: 'admin' });
    try {
      await pool.query('UPDATE tenants SET active = false WHERE id = $1', [inactiveTenantId]);
      const result = await listMyTenants(pool, { id, email, role: 'admin' });
      const ids = result.map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining([activeTenantId, inactiveTenantId]));
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, activeTenantId);
      await deleteTestTenant(pool, inactiveTenantId);
    }
  });

  it('colaborador sees every tenant, same as admin', async () => {
    const tenantId = await createTestTenant(pool, 'Colab Visible Co');
    const { id, email } = await createTestUser(pool, { role: 'colaborador' });
    try {
      const result = await listMyTenants(pool, { id, email, role: 'colaborador' });
      expect(result.map((t) => t.id)).toContain(tenantId);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
    }
  });

  it('cliente sees only their own active tenants', async () => {
    const ownTenantId = await createTestTenant(pool, 'Own Co');
    const otherTenantId = await createTestTenant(pool, 'Other Co');
    const disabledTenantId = await createTestTenant(pool, 'Disabled Co');
    const { id, email } = await createTestUser(pool, { role: 'cliente' });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, ownTenantId]);
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, disabledTenantId]);
      await pool.query('UPDATE tenants SET active = false WHERE id = $1', [disabledTenantId]);

      const result = await listMyTenants(pool, { id, email, role: 'cliente' });
      expect(result).toEqual([{ id: ownTenantId, name: 'Own Co' }]);
      const ids = result.map((t) => t.id);
      expect(ids).not.toContain(otherTenantId);
      expect(ids).not.toContain(disabledTenantId);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, ownTenantId);
      await deleteTestTenant(pool, otherTenantId);
      await deleteTestTenant(pool, disabledTenantId);
    }
  });

  it('cliente with no user_tenant_access rows at all sees an empty list', async () => {
    const { id, email } = await createTestUser(pool, { role: 'cliente' });
    try {
      const result = await listMyTenants(pool, { id, email, role: 'cliente' });
      expect(result).toEqual([]);
    } finally {
      await deleteTestUser(pool, id);
    }
  });
});
