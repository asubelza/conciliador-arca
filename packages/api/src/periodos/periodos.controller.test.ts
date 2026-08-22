import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T18 — integration coverage for the actual HTTP wiring of
 * POST/GET /api/periodos and GET /api/periodos/:id (RF-12), against the
 * real PostgreSQL test database (013_init_periodos.sql). The exhaustive
 * request-shape validation matrix lives in periodos-validation.test.ts;
 * this file proves the controller + real UNIQUE(tenant_id, mes) constraint
 * are wired correctly end to end.
 */
describe('T18: /api/periodos (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodos.controller.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
    await app.close();
  });

  describe('POST /api/periodos', () => {
    it('RF-12 Scenario: creates a período with estado=abierto and returns its id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-04-01' });

      expect(res.status).toBe(201);
      expect(typeof res.body.id).toBe('string');
      expect(res.body.tenant_id).toBe(tenantId);
      expect(res.body.estado).toBe('abierto');
      expect(res.body.mes).toBe('2026-04-01');
      expect(res.body.tolerancia_ars).toBeNull();
      expect(res.body.cerrado_at).toBeNull();
    });

    it('normalizes a YYYY-MM mes to the 1st of the month', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-05' });

      expect(res.status).toBe(201);
      expect(res.body.mes).toBe('2026-05-01');
    });

    it('RF-12 Scenario: rejects a duplicate período for the same tenant+month with 409', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-06-01' });
      expect(first.status).toBe(201);

      const dup = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-06-15' }); // same month, different day
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatch(/already has a período for that month/);

      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM periodos WHERE tenant_id = $1 AND mes = '2026-06-01'",
        [tenantId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('RF-12 Scenario: two tenants can each have their own período for the same month', async () => {
      const otherTenantId = await createTestTenant(pool, 'periodos.controller.test (other)');
      try {
        const res1 = await request(app.getHttpServer())
          .post('/api/periodos')
          .send({ tenant_id: tenantId, mes: '2026-07-01' });
        const res2 = await request(app.getHttpServer())
          .post('/api/periodos')
          .send({ tenant_id: otherTenantId, mes: '2026-07-01' });

        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);
        expect(res1.body.id).not.toBe(res2.body.id);
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 400 for a missing/non-UUID tenant_id', async () => {
      const res = await request(app.getHttpServer()).post('/api/periodos').send({ mes: '2026-04-01' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
    });

    it('returns 400 for a missing/malformed mes', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mes/);
    });
  });

  describe('GET /api/periodos', () => {
    it('lists a tenant’s períodos, most recent month first', async () => {
      const listTenantId = await createTestTenant(pool, 'periodos.controller.test (list)');
      try {
        await request(app.getHttpServer()).post('/api/periodos').send({ tenant_id: listTenantId, mes: '2026-01-01' });
        await request(app.getHttpServer()).post('/api/periodos').send({ tenant_id: listTenantId, mes: '2026-03-01' });
        await request(app.getHttpServer()).post('/api/periodos').send({ tenant_id: listTenantId, mes: '2026-02-01' });

        const res = await request(app.getHttpServer()).get(`/api/periodos?tenant_id=${listTenantId}`);
        expect(res.status).toBe(200);
        expect(res.body.periodos.map((p: { mes: string }) => p.mes)).toEqual([
          '2026-03-01',
          '2026-02-01',
          '2026-01-01',
        ]);
      } finally {
        await deleteTestTenant(pool, listTenantId);
      }
    });

    it("doesn't return another tenant's períodos", async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/periodos?tenant_id=00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(200);
      expect(res.body.periodos).toEqual([]);
    });

    it('returns 400 for a missing/malformed tenant_id query param', async () => {
      const res = await request(app.getHttpServer()).get('/api/periodos');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant_id query param is required and must be a UUID' });
    });
  });

  describe('GET /api/periodos/:id', () => {
    it('returns the período detail', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-08-01' });

      const res = await request(app.getHttpServer()).get(`/api/periodos/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created.body);
    });

    it('returns 404 for an unknown período id', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/periodos/00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'período not found' });
    });

    it('returns 400 for a malformed período id', async () => {
      const res = await request(app.getHttpServer()).get('/api/periodos/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'periodo id must be a UUID' });
    });
  });
});
