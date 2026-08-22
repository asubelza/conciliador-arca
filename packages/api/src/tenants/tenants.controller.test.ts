import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import {
  authHeaderFor,
  createTestTenant,
  createTestUser,
  deleteTestTenant,
  deleteTestUser,
} from '../test-support/pg-test-helpers';

/**
 * T20 (RF-18) — integration coverage for GET/PUT /api/tenants/:id/config
 * against the real PostgreSQL test database
 * (014_alter_tenants_add_tolerancia.sql).
 *
 * T38 (Fase 2, autenticacion-roles): every request below now needs a
 * bearer token — `adminAuth` is used throughout since admin always passes
 * both the role check (PUT is admin-only) and assertTenantAccess (admin
 * sees every tenant). The dedicated `describe('auth (T38)')` block below
 * proves the guard/role/tenant checks themselves, not just that they don't
 * get in the way of the pre-existing behavior.
 */
describe('T20: /api/tenants/:id/config (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  let tenantId: string;
  const adminAuth = authHeaderFor('admin');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'tenants.controller.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
    await app.close();
  });

  describe('GET /api/tenants/:id/config', () => {
    it('returns the default tolerance (0.99) for a freshly created tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tenantId, tolerancia_redondeo_ars: '0.99', tolerancia_dias_fecha: 5 });
    });

    it('returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/00000000-0000-0000-0000-000000000000/config')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'tenant not found' });
    });

    it('returns 400 for a malformed tenant id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/not-a-uuid/config')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant id must be a UUID' });
    });
  });

  describe('PUT /api/tenants/:id/config', () => {
    it('updates the tolerance and persists it', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth)
        .send({ tolerancia_redondeo_ars: 2.5, tolerancia_dias_fecha: 10 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tenantId, tolerancia_redondeo_ars: '2.50', tolerancia_dias_fecha: 10 });

      const getRes = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth);
      expect(getRes.body.tolerancia_redondeo_ars).toBe('2.50');
      expect(getRes.body.tolerancia_dias_fecha).toBe(10);

      // put it back so other tests in this file see the documented default
      await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth)
        .send({ tolerancia_redondeo_ars: 0.99, tolerancia_dias_fecha: 5 });
    });

    it('returns 400 for a negative tolerance and does not change the stored value', async () => {
      const before = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth);

      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth)
        .send({ tolerancia_redondeo_ars: -5, tolerancia_dias_fecha: 5 });
      expect(res.status).toBe(400);

      const after = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth);
      expect(after.body.tolerancia_redondeo_ars).toBe(before.body.tolerancia_redondeo_ars);
    });

    it('returns 400 for an invalid tolerancia_dias_fecha and does not change the stored value', async () => {
      const before = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth);

      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth)
        .send({ tolerancia_redondeo_ars: 0.99, tolerancia_dias_fecha: -1 });
      expect(res.status).toBe(400);

      const after = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', adminAuth);
      expect(after.body.tolerancia_dias_fecha).toBe(before.body.tolerancia_dias_fecha);
    });

    it('returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/tenants/00000000-0000-0000-0000-000000000000/config')
        .set('Authorization', adminAuth)
        .send({ tolerancia_redondeo_ars: 1, tolerancia_dias_fecha: 5 });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'tenant not found' });
    });
  });

  describe('auth (T38, autenticacion-roles)', () => {
    it('GET with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/config`);
      expect(res.status).toBe(401);
    });

    it('PUT with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .send({ tolerancia_redondeo_ars: 1, tolerancia_dias_fecha: 5 });
      expect(res.status).toBe(401);
    });

    it('PUT as colaborador returns 403 (config write is admin-only)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .set('Authorization', authHeaderFor('colaborador'))
        .send({ tolerancia_redondeo_ars: 1, tolerancia_dias_fecha: 5 });
      expect(res.status).toBe(403);
    });

    it('GET as colaborador is allowed (read access is open to all 3 roles)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/config`)
        .set('Authorization', authHeaderFor('colaborador'));
      expect(res.status).toBe(200);
    });

    it('GET as a cliente WITHOUT user_tenant_access for this tenant returns 403', async () => {
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/tenants/${tenantId}/config`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId }));
        expect(res.status).toBe(403);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('GET as a cliente WITH user_tenant_access for this tenant is allowed', async () => {
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userId, tenantId]);
        const res = await request(app.getHttpServer())
          .get(`/api/tenants/${tenantId}/config`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId }));
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });
  });
});
