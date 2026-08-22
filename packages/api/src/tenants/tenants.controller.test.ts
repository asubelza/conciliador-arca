import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T20 (RF-18) — integration coverage for GET/PUT /api/tenants/:id/config
 * against the real PostgreSQL test database
 * (014_alter_tenants_add_tolerancia.sql).
 */
describe('T20: /api/tenants/:id/config (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  let tenantId: string;

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
      const res = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/config`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tenantId, tolerancia_redondeo_ars: '0.99' });
    });

    it('returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/tenants/00000000-0000-0000-0000-000000000000/config',
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'tenant not found' });
    });

    it('returns 400 for a malformed tenant id', async () => {
      const res = await request(app.getHttpServer()).get('/api/tenants/not-a-uuid/config');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant id must be a UUID' });
    });
  });

  describe('PUT /api/tenants/:id/config', () => {
    it('updates the tolerance and persists it', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .send({ tolerancia_redondeo_ars: 2.5 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tenantId, tolerancia_redondeo_ars: '2.50' });

      const getRes = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/config`);
      expect(getRes.body.tolerancia_redondeo_ars).toBe('2.50');

      // put it back so other tests in this file see the documented default
      await request(app.getHttpServer()).put(`/api/tenants/${tenantId}/config`).send({ tolerancia_redondeo_ars: 0.99 });
    });

    it('returns 400 for a negative tolerance and does not change the stored value', async () => {
      const before = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/config`);

      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}/config`)
        .send({ tolerancia_redondeo_ars: -5 });
      expect(res.status).toBe(400);

      const after = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/config`);
      expect(after.body.tolerancia_redondeo_ars).toBe(before.body.tolerancia_redondeo_ars);
    });

    it('returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/tenants/00000000-0000-0000-0000-000000000000/config')
        .send({ tolerancia_redondeo_ars: 1 });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'tenant not found' });
    });
  });
});
