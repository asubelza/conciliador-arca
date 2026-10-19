import { Pool } from 'pg';
import { login, listMyTenants } from './auth.service';
import { verifyToken } from './jwt';
import {
  createTestUser,
  deleteTestUser,
  createTestTenant,
  deleteTestTenant,
  createTestEstudio,
  deleteTestEstudio,
} from '../test-support/pg-test-helpers';

describe('T34/T35: login (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('a correct email/password issues a valid JWT and the right user shape', async () => {
    const estudioId = await createTestEstudio(pool);
    const { id, email, password } = await createTestUser(pool, { role: 'admin', estudioId });
    try {
      const result = await login(pool, email, password);
      if ('code' in result) throw new Error('expected success');
      expect(result.user).toEqual({ id, email, role: 'admin', display_name: null, estudio_id: estudioId });

      const payload = verifyToken(result.token);
      expect(payload).toEqual({ sub: id, role: 'admin', email, estudio_id: estudioId });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('estudio_id round-trips as null through login for a platform-tier staff user', async () => {
    const { id, email, password } = await createTestUser(pool, { role: 'admin', estudioId: null });
    try {
      const result = await login(pool, email, password);
      if ('code' in result) throw new Error('expected success');
      expect(result.user.estudio_id).toBeNull();

      const payload = verifyToken(result.token);
      expect(payload?.estudio_id).toBeNull();
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

  it('admin sees every tenant in their OWN estudio, including inactive ones', async () => {
    const estudioId = await createTestEstudio(pool);
    const activeTenantId = await createTestTenant(pool, 'Active Co', undefined, estudioId);
    const inactiveTenantId = await createTestTenant(pool, 'Inactive Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'admin', estudioId });
    try {
      await pool.query('UPDATE tenants SET active = false WHERE id = $1', [inactiveTenantId]);
      const result = await listMyTenants(pool, { id, email, role: 'admin', estudio_id: estudioId });
      const ids = result.map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining([activeTenantId, inactiveTenantId]));
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, activeTenantId);
      await deleteTestTenant(pool, inactiveTenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('colaborador sees every tenant in their OWN estudio, same as admin', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Colab Visible Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'colaborador', estudioId });
    try {
      const result = await listMyTenants(pool, { id, email, role: 'colaborador', estudio_id: estudioId });
      expect(result.map((t) => t.id)).toContain(tenantId);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('admin in estudio A does NOT see a tenant that belongs to estudio B', async () => {
    const estudioA = await createTestEstudio(pool, 'Estudio A');
    const estudioB = await createTestEstudio(pool, 'Estudio B');
    const tenantInA = await createTestTenant(pool, 'Tenant In A', undefined, estudioA);
    const tenantInB = await createTestTenant(pool, 'Tenant In B', undefined, estudioB);
    const { id, email } = await createTestUser(pool, { role: 'admin', estudioId: estudioA });
    try {
      const result = await listMyTenants(pool, { id, email, role: 'admin', estudio_id: estudioA });
      const ids = result.map((t) => t.id);
      expect(ids).toContain(tenantInA);
      expect(ids).not.toContain(tenantInB);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantInA);
      await deleteTestTenant(pool, tenantInB);
      await deleteTestEstudio(pool, estudioA);
      await deleteTestEstudio(pool, estudioB);
    }
  });

  it('platform-tier staff (estudio_id: null) sees an empty list, no query at all', async () => {
    const { id, email } = await createTestUser(pool, { role: 'admin', estudioId: null });
    try {
      const result = await listMyTenants(pool, { id, email, role: 'admin', estudio_id: null });
      expect(result).toEqual([]);
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('cliente sees only their own active tenants, within their own estudio', async () => {
    const estudioId = await createTestEstudio(pool);
    const ownTenantId = await createTestTenant(pool, 'Own Co', undefined, estudioId);
    const otherTenantId = await createTestTenant(pool, 'Other Co', undefined, estudioId);
    const disabledTenantId = await createTestTenant(pool, 'Disabled Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, ownTenantId]);
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, disabledTenantId]);
      await pool.query('UPDATE tenants SET active = false WHERE id = $1', [disabledTenantId]);

      const result = await listMyTenants(pool, { id, email, role: 'cliente', estudio_id: estudioId });
      expect(result).toEqual([{ id: ownTenantId, name: 'Own Co' }]);
      const ids = result.map((t) => t.id);
      expect(ids).not.toContain(otherTenantId);
      expect(ids).not.toContain(disabledTenantId);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, ownTenantId);
      await deleteTestTenant(pool, otherTenantId);
      await deleteTestTenant(pool, disabledTenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it("cliente does NOT see a tenant they have user_tenant_access to if it belongs to a different estudio than their own (defense-in-depth)", async () => {
    const estudioA = await createTestEstudio(pool, 'Estudio A');
    const estudioB = await createTestEstudio(pool, 'Estudio B');
    const tenantInB = await createTestTenant(pool, 'Tenant In B', undefined, estudioB);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId: estudioA });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, tenantInB]);
      const result = await listMyTenants(pool, { id, email, role: 'cliente', estudio_id: estudioA });
      expect(result).toEqual([]);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantInB);
      await deleteTestEstudio(pool, estudioA);
      await deleteTestEstudio(pool, estudioB);
    }
  });

  it('cliente with no user_tenant_access rows at all sees an empty list', async () => {
    const estudioId = await createTestEstudio(pool);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId });
    try {
      const result = await listMyTenants(pool, { id, email, role: 'cliente', estudio_id: estudioId });
      expect(result).toEqual([]);
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestEstudio(pool, estudioId);
    }
  });
});
