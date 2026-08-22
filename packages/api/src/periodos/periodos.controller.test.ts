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

  /**
   * T27/T29 — integration coverage for the actual HTTP wiring of
   * POST /api/periodos/:id/cerrar and GET /api/periodos/:id/report
   * (RF-20–RF-23). Exhaustive matching-taxonomy/snapshot-shape coverage
   * lives in periodo-cierre.test.ts and periodo-report.test.ts; this proves
   * the controller maps their typed results/failures to the right HTTP
   * status/body.
   */
  describe('POST /api/periodos/:id/cerrar and GET /api/periodos/:id/report', () => {
    it('closes an open período, then the report reflects the frozen snapshot', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-09-01' });
      const periodoId = created.body.id;

      const openReport = await request(app.getHttpServer()).get(`/api/periodos/${periodoId}/report`);
      expect(openReport.status).toBe(200);
      expect(openReport.body.live).toBe(true);
      expect(openReport.body.sections).toEqual({
        conciliados_ok: [],
        discrepancias_y_alertas: [],
        pendientes_en_arca: [],
      });

      const cerrar = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/cerrar`)
        .send({ cerrado_por: 'contador@estudio.com' });
      expect(cerrar.status).toBe(200);
      expect(cerrar.body.periodo.estado).toBe('cerrado');
      expect(cerrar.body.periodo.cerrado_por).toBe('contador@estudio.com');
      expect(cerrar.body.counts).toBeDefined();

      const detail = await request(app.getHttpServer()).get(`/api/periodos/${periodoId}`);
      expect(detail.body.estado).toBe('cerrado');

      const closedReport = await request(app.getHttpServer()).get(`/api/periodos/${periodoId}/report`);
      expect(closedReport.status).toBe(200);
      expect(closedReport.body.live).toBe(false);
    });

    it('format=csv and format=xlsx download the período report (client-requested 2026-08-22)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2027-01-01' });
      const periodoId = created.body.id;

      const csv = await request(app.getHttpServer()).get(`/api/periodos/${periodoId}/report?format=csv`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('attachment');
      expect(csv.text.split('\n')[0]).toBe(
        'seccion,clasificacion,cuit_emisor,tipo_cbte,punto_venta,numero,fecha_emision,importe_arca,importe_sistema,divergencia_ars,antiguedad_meses',
      );

      const xlsx = await request(app.getHttpServer()).get(`/api/periodos/${periodoId}/report?format=xlsx`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      expect(Buffer.isBuffer(xlsx.body)).toBe(true);
      expect(xlsx.body.length).toBeGreaterThan(0);
    });

    it('returns 400 for an unsupported format value', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2027-02-01' });
      const periodoId = created.body.id;

      const bad = await request(app.getHttpServer()).get(`/api/periodos/${periodoId}/report?format=pdf`);
      expect(bad.status).toBe(400);
    });

    it('rejects closing an already-cerrado período with 409', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-10-01' });
      const periodoId = created.body.id;

      const first = await request(app.getHttpServer()).post(`/api/periodos/${periodoId}/cerrar`).send({});
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer()).post(`/api/periodos/${periodoId}/cerrar`).send({});
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: 'período is already cerrado' });
    });

    it('returns 404 closing/reporting an unknown período id', async () => {
      const unknown = '00000000-0000-0000-0000-000000000000';
      const cerrar = await request(app.getHttpServer()).post(`/api/periodos/${unknown}/cerrar`).send({});
      expect(cerrar.status).toBe(404);

      const report = await request(app.getHttpServer()).get(`/api/periodos/${unknown}/report`);
      expect(report.status).toBe(404);
    });

    it('returns 400 for a malformed período id on both endpoints', async () => {
      const cerrar = await request(app.getHttpServer()).post('/api/periodos/not-a-uuid/cerrar').send({});
      expect(cerrar.status).toBe(400);

      const report = await request(app.getHttpServer()).get('/api/periodos/not-a-uuid/report');
      expect(report.status).toBe(400);
    });

    it('returns 400 for a non-string cerrado_por', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-11-01' });

      const cerrar = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/cerrar`)
        .send({ cerrado_por: 123 });
      expect(cerrar.status).toBe(400);
      expect(cerrar.body).toEqual({ error: 'cerrado_por must be a string when provided' });
    });
  });
});
