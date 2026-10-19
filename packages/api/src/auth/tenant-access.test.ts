import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { assertTenantAccess } from './tenant-access';
import {
  createTestUser,
  deleteTestUser,
  createTestTenant,
  deleteTestTenant,
  createTestEstudio,
  deleteTestEstudio,
} from '../test-support/pg-test-helpers';

describe('T37/multi-estudio pivot: assertTenantAccess (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('admin passes for a tenant in their OWN estudio', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Admin Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'admin', estudioId });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'admin', estudio_id: estudioId }, tenantId);
      expect(result).toBeUndefined();
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('colaborador passes for a tenant in their OWN estudio', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Colaborador Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'colaborador', estudioId });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'colaborador', estudio_id: estudioId }, tenantId);
      expect(result).toBeUndefined();
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('admin in estudio A gets a 403 for a tenant that belongs to estudio B (NEW — did not exist before the pivot)', async () => {
    const estudioA = await createTestEstudio(pool, 'Estudio A');
    const estudioB = await createTestEstudio(pool, 'Estudio B');
    const tenantInB = await createTestTenant(pool, 'Tenant In B', undefined, estudioB);
    const { id, email } = await createTestUser(pool, { role: 'admin', estudioId: estudioA });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'admin', estudio_id: estudioA }, tenantInB);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantInB);
      await deleteTestEstudio(pool, estudioA);
      await deleteTestEstudio(pool, estudioB);
    }
  });

  it('colaborador in estudio A gets a 403 for a tenant that belongs to estudio B', async () => {
    const estudioA = await createTestEstudio(pool, 'Estudio A');
    const estudioB = await createTestEstudio(pool, 'Estudio B');
    const tenantInB = await createTestTenant(pool, 'Tenant In B', undefined, estudioB);
    const { id, email } = await createTestUser(pool, { role: 'colaborador', estudioId: estudioA });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'colaborador', estudio_id: estudioA }, tenantInB);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantInB);
      await deleteTestEstudio(pool, estudioA);
      await deleteTestEstudio(pool, estudioB);
    }
  });

  it('admin gets a 403 for a tenant id that does not exist at all (no unconditional pass anymore)', async () => {
    const estudioId = await createTestEstudio(pool);
    const { id, email } = await createTestUser(pool, { role: 'admin', estudioId });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'admin', estudio_id: estudioId }, randomUUID());
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('platform-tier staff (estudio_id: null) gets a 403 for ANY tenant, even with an admin/colaborador role', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Some Co', undefined, estudioId);
    const { id: adminId, email: adminEmail } = await createTestUser(pool, { role: 'admin', estudioId: null });
    const { id: colabId, email: colabEmail } = await createTestUser(pool, { role: 'colaborador', estudioId: null });
    try {
      const adminResult = await assertTenantAccess(
        pool,
        { id: adminId, email: adminEmail, role: 'admin', estudio_id: null },
        tenantId,
      );
      const colabResult = await assertTenantAccess(
        pool,
        { id: colabId, email: colabEmail, role: 'colaborador', estudio_id: null },
        tenantId,
      );
      expect(adminResult).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
      expect(colabResult).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, adminId);
      await deleteTestUser(pool, colabId);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('cliente with a user_tenant_access row for that tenant passes (same estudio)', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Cliente Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, tenantId]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente', estudio_id: estudioId }, tenantId);
      expect(result).toBeUndefined();
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('cliente with a user_tenant_access row for a DISABLED tenant gets a 403, same shape as no membership', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Cliente Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, tenantId]);
      await pool.query('UPDATE tenants SET active = false WHERE id = $1', [tenantId]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente', estudio_id: estudioId }, tenantId);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('cliente with NO user_tenant_access row for that tenant gets a 403, not a 404 (never confirms/denies existence)', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Cliente Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId });
    try {
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente', estudio_id: estudioId }, tenantId);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it('cliente with access to a DIFFERENT tenant (same estudio) is still rejected for this one', async () => {
    const estudioId = await createTestEstudio(pool);
    const ownTenantId = await createTestTenant(pool, 'Own Co', undefined, estudioId);
    const otherTenantId = await createTestTenant(pool, 'Other Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, ownTenantId]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente', estudio_id: estudioId }, otherTenantId);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, ownTenantId);
      await deleteTestTenant(pool, otherTenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });

  it("cliente with a user_tenant_access row whose OWN estudio_id differs from the tenant's estudio_id gets a 403 (defense-in-depth)", async () => {
    const estudioA = await createTestEstudio(pool, 'Estudio A');
    const estudioB = await createTestEstudio(pool, 'Estudio B');
    const tenantInB = await createTestTenant(pool, 'Tenant In B', undefined, estudioB);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId: estudioA });
    try {
      // Force the cross-estudio scenario even though it "shouldn't" happen
      // by construction — this row only exists to prove the estudio_id
      // check in the SQL itself is the real gate, not just app-level glue.
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, tenantInB]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente', estudio_id: estudioA }, tenantInB);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantInB);
      await deleteTestEstudio(pool, estudioA);
      await deleteTestEstudio(pool, estudioB);
    }
  });

  it('platform-tier cliente (estudio_id: null) gets a 403 even with a matching user_tenant_access row', async () => {
    const estudioId = await createTestEstudio(pool);
    const tenantId = await createTestTenant(pool, 'Some Co', undefined, estudioId);
    const { id, email } = await createTestUser(pool, { role: 'cliente', estudioId: null });
    try {
      await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, tenantId]);
      const result = await assertTenantAccess(pool, { id, email, role: 'cliente', estudio_id: null }, tenantId);
      expect(result).toEqual({ status: 403, error: 'no tenés acceso a este tenant' });
    } finally {
      await deleteTestUser(pool, id);
      await deleteTestTenant(pool, tenantId);
      await deleteTestEstudio(pool, estudioId);
    }
  });
});
