import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import {
  authHeaderFor,
  createTestTenant,
  createTestUser,
  deleteTestTenant,
  deleteTestUser,
} from '../test-support/pg-test-helpers';

/**
 * RF-04/RF-13/RF-09 — same fixture shape as
 * periodo-matching-engine.test.ts's own insertVoucher: fixtures are
 * inserted straight into vouchers_canonical via SQL, independent of the
 * upsert module's own (separately-tested) semantics.
 */
async function insertVoucher(
  pool: Pool,
  tenantId: string,
  periodoAltaId: string,
  overrides: { cuitEmisor?: string; tipoCbte?: number; puntoVenta?: number; numero?: number; fileSource: 'arca' | 'contabilidad' } = {
    fileSource: 'arca',
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vouchers_canonical (
       tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
       file_source, periodo_alta_id, fecha
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      tenantId,
      overrides.cuitEmisor ?? '30111111112',
      overrides.tipoCbte ?? 1,
      overrides.puntoVenta ?? 1,
      overrides.numero ?? Math.floor(Math.random() * 1_000_000),
      1000,
      overrides.fileSource,
      periodoAltaId,
      '2026-01-15',
    ],
  );
  return rows[0].id;
}

/**
 * T18 — integration coverage for the actual HTTP wiring of
 * POST/GET /api/periodos and GET /api/periodos/:id (RF-12), against the
 * real PostgreSQL test database (013_init_periodos.sql). The exhaustive
 * request-shape validation matrix lives in periodos-validation.test.ts;
 * this file proves the controller + real UNIQUE(tenant_id, mes) constraint
 * are wired correctly end to end.
 *
 * T38 (Fase 2, autenticacion-roles): every request below now needs a
 * bearer token — `adminAuth` throughout, since admin passes every role
 * check (create/cerrar are admin/colaborador-only) and every
 * assertTenantAccess check (admin sees every tenant). The dedicated
 * `describe('auth (T38)')` block at the end proves the guard/role/tenant
 * checks themselves.
 */
describe('T18: /api/periodos (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  let tenantId: string;
  const adminAuth = authHeaderFor('admin');

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
        .set('Authorization', adminAuth)
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
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2026-05' });

      expect(res.status).toBe(201);
      expect(res.body.mes).toBe('2026-05-01');
    });

    it('RF-12 Scenario: rejects a duplicate período for the same tenant+month with 409', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2026-06-01' });
      expect(first.status).toBe(201);

      const dup = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
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
          .set('Authorization', adminAuth)
          .send({ tenant_id: tenantId, mes: '2026-07-01' });
        const res2 = await request(app.getHttpServer())
          .post('/api/periodos')
          .set('Authorization', adminAuth)
          .send({ tenant_id: otherTenantId, mes: '2026-07-01' });

        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);
        expect(res1.body.id).not.toBe(res2.body.id);
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 400 for a missing/non-UUID tenant_id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ mes: '2026-04-01' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
    });

    it('returns 400 for a missing/malformed mes', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mes/);
    });
  });

  describe('GET /api/periodos', () => {
    it('lists a tenant’s períodos, most recent month first', async () => {
      const listTenantId = await createTestTenant(pool, 'periodos.controller.test (list)');
      try {
        await request(app.getHttpServer())
          .post('/api/periodos')
          .set('Authorization', adminAuth)
          .send({ tenant_id: listTenantId, mes: '2026-01-01' });
        await request(app.getHttpServer())
          .post('/api/periodos')
          .set('Authorization', adminAuth)
          .send({ tenant_id: listTenantId, mes: '2026-03-01' });
        await request(app.getHttpServer())
          .post('/api/periodos')
          .set('Authorization', adminAuth)
          .send({ tenant_id: listTenantId, mes: '2026-02-01' });

        const res = await request(app.getHttpServer())
          .get(`/api/periodos?tenant_id=${listTenantId}`)
          .set('Authorization', adminAuth);
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
      const res = await request(app.getHttpServer())
        .get('/api/periodos?tenant_id=00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.periodos).toEqual([]);
    });

    it('returns 400 for a missing/malformed tenant_id query param', async () => {
      const res = await request(app.getHttpServer()).get('/api/periodos').set('Authorization', adminAuth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant_id query param is required and must be a UUID' });
    });
  });

  describe('GET /api/periodos/:id', () => {
    it('returns the período detail', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2026-08-01' });

      const res = await request(app.getHttpServer())
        .get(`/api/periodos/${created.body.id}`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created.body);
    });

    it('returns 404 for an unknown período id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/periodos/00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'período not found' });
    });

    it('returns 400 for a malformed período id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/periodos/not-a-uuid')
        .set('Authorization', adminAuth);
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
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2026-09-01' });
      const periodoId = created.body.id;

      const openReport = await request(app.getHttpServer())
        .get(`/api/periodos/${periodoId}/report`)
        .set('Authorization', adminAuth);
      expect(openReport.status).toBe(200);
      expect(openReport.body.live).toBe(true);
      expect(openReport.body.sections).toEqual({
        conciliados_ok: [],
        discrepancias_y_alertas: [],
        pendientes_en_arca: [],
        posibles_coincidencias: [],
      });

      const cerrar = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/cerrar`)
        .set('Authorization', adminAuth)
        .send({ cerrado_por: 'contador@estudio.com' });
      expect(cerrar.status).toBe(200);
      expect(cerrar.body.periodo.estado).toBe('cerrado');
      expect(cerrar.body.periodo.cerrado_por).toBe('contador@estudio.com');
      expect(cerrar.body.counts).toBeDefined();

      const detail = await request(app.getHttpServer())
        .get(`/api/periodos/${periodoId}`)
        .set('Authorization', adminAuth);
      expect(detail.body.estado).toBe('cerrado');

      const closedReport = await request(app.getHttpServer())
        .get(`/api/periodos/${periodoId}/report`)
        .set('Authorization', adminAuth);
      expect(closedReport.status).toBe(200);
      expect(closedReport.body.live).toBe(false);
    });

    it('format=csv and format=xlsx download the período report (client-requested 2026-08-22)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-01-01' });
      const periodoId = created.body.id;

      const csv = await request(app.getHttpServer())
        .get(`/api/periodos/${periodoId}/report?format=csv`)
        .set('Authorization', adminAuth);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('attachment');
      expect(csv.text.split('\n')[0]).toBe(
        'seccion,clasificacion,cuit_emisor,tipo_cbte,punto_venta,numero,fecha_emision,importe_arca,importe_sistema,divergencia_ars,antiguedad_meses',
      );

      const xlsx = await request(app.getHttpServer())
        .get(`/api/periodos/${periodoId}/report?format=xlsx`)
        .set('Authorization', adminAuth)
        .buffer(true)
        .parse((res, cb) => {
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
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-02-01' });
      const periodoId = created.body.id;

      const bad = await request(app.getHttpServer())
        .get(`/api/periodos/${periodoId}/report?format=pdf`)
        .set('Authorization', adminAuth);
      expect(bad.status).toBe(400);
    });

    it('rejects closing an already-cerrado período with 409', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2026-10-01' });
      const periodoId = created.body.id;

      const first = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/cerrar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/cerrar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: 'período is already cerrado' });
    });

    it('returns 404 closing/reporting an unknown período id', async () => {
      const unknown = '00000000-0000-0000-0000-000000000000';
      const cerrar = await request(app.getHttpServer())
        .post(`/api/periodos/${unknown}/cerrar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(cerrar.status).toBe(404);

      const report = await request(app.getHttpServer())
        .get(`/api/periodos/${unknown}/report`)
        .set('Authorization', adminAuth);
      expect(report.status).toBe(404);
    });

    it('returns 400 for a malformed período id on both endpoints', async () => {
      const cerrar = await request(app.getHttpServer())
        .post('/api/periodos/not-a-uuid/cerrar')
        .set('Authorization', adminAuth)
        .send({});
      expect(cerrar.status).toBe(400);

      const report = await request(app.getHttpServer())
        .get('/api/periodos/not-a-uuid/report')
        .set('Authorization', adminAuth);
      expect(report.status).toBe(400);
    });

    it('returns 400 for a non-string cerrado_por', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2026-11-01' });

      const cerrar = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/cerrar`)
        .set('Authorization', adminAuth)
        .send({ cerrado_por: 123 });
      expect(cerrar.status).toBe(400);
      expect(cerrar.body).toEqual({ error: 'cerrado_por must be a string when provided' });
    });
  });

  /**
   * RF-04/RF-13 — integration coverage for the actual HTTP wiring of
   * POST /api/periodos/:id/coincidencias. The similarity-detection logic
   * itself (findSimilarityCandidate, fetchFuzzyConfirmations) is covered
   * exhaustively in periodo-matching-engine.test.ts; this proves the
   * controller's validation/auth/state-guard chain and the upsert into
   * fuzzy_match_confirmations.
   */
  describe('POST /api/periodos/:id/coincidencias', () => {
    it('confirms a similarity pairing: 200, persists status=confirmado, logs a confirm_similarity audit event', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-01-01' });
      const periodoId = created.body.id;
      const sistemaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'contabilidad' });
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: sistemaId, arca_voucher_id: arcaId, accion: 'confirmar' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmado');
      expect(res.body.sistema_voucher_id).toBe(sistemaId);
      expect(res.body.arca_voucher_id).toBe(arcaId);

      const { rows } = await pool.query(
        'SELECT status FROM fuzzy_match_confirmations WHERE sistema_voucher_id = $1 AND arca_voucher_id = $2',
        [sistemaId, arcaId],
      );
      expect(rows).toEqual([{ status: 'confirmado' }]);

      const audit = await pool.query(
        "SELECT action, entity, entity_id, details FROM audit_trail WHERE tenant_id = $1 AND action = 'confirm_similarity' ORDER BY created_at DESC LIMIT 1",
        [tenantId],
      );
      expect(audit.rows[0]).toMatchObject({
        entity: 'vouchers_canonical',
        entity_id: sistemaId,
        details: { arca_voucher_id: arcaId, status: 'confirmado' },
      });
    });

    it('discards a similarity pairing: 200, persists status=descartado', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-02-01' });
      const periodoId = created.body.id;
      const sistemaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'contabilidad' });
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: sistemaId, arca_voucher_id: arcaId, accion: 'descartar' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('descartado');
    });

    it('re-confirming/discarding the same pair updates the existing row instead of erroring (ON CONFLICT upsert)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-03-01' });
      const periodoId = created.body.id;
      const sistemaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'contabilidad' });
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca' });

      const first = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: sistemaId, arca_voucher_id: arcaId, accion: 'confirmar' });
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: sistemaId, arca_voucher_id: arcaId, accion: 'descartar' });
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('descartado');

      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM fuzzy_match_confirmations WHERE sistema_voucher_id = $1 AND arca_voucher_id = $2',
        [sistemaId, arcaId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('returns 400 for a malformed body (bad accion)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-04-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: randomUUID(), arca_voucher_id: randomUUID(), accion: 'aceptar' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown período id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos/00000000-0000-0000-0000-000000000000/coincidencias')
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: randomUUID(), arca_voucher_id: randomUUID(), accion: 'confirmar' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when the voucher ids do not reference existing vouchers for this tenant', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-05-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: randomUUID(), arca_voucher_id: randomUUID(), accion: 'confirmar' });
      expect(res.status).toBe(404);
    });

    it('returns 409 when the período is already cerrado', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-06-01' });
      const periodoId = created.body.id;
      const sistemaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'contabilidad' });
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca' });

      const cerrar = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/cerrar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(cerrar.status).toBe(200);

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/coincidencias`)
        .set('Authorization', adminAuth)
        .send({ sistema_voucher_id: sistemaId, arca_voucher_id: arcaId, accion: 'confirmar' });
      expect(res.status).toBe(409);
    });
  });

  /**
   * 2026-08-23 (client request, feature 2 de 3) — integration coverage for
   * POST /api/periodos/:id/pendientes-arca-resolver ("Marcar como resuelto
   * sin pareja"): resolves a single ARCA pendiente without linking it to
   * any sistema voucher, and it must then vanish from pendiente_en_arca on
   * the next report read.
   */
  describe('POST /api/periodos/:id/pendientes-arca-resolver', () => {
    it('resolves a pendiente ARCA voucher: 200, sets estado=conciliado, logs a resolve_pendiente_manual audit event', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-02-01' });
      const periodoId = created.body.id;
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: arcaId, nota: 'nunca va a matchear, cargado antes de usar el sistema' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: arcaId, estado: 'conciliado' });

      const { rows } = await pool.query('SELECT estado FROM vouchers_canonical WHERE id = $1', [arcaId]);
      expect(rows[0].estado).toBe('conciliado');

      const audit = await pool.query(
        "SELECT entity, entity_id, details FROM audit_trail WHERE tenant_id = $1 AND action = 'resolve_pendiente_manual' ORDER BY created_at DESC LIMIT 1",
        [tenantId],
      );
      expect(audit.rows[0]).toMatchObject({
        entity: 'vouchers_canonical',
        entity_id: arcaId,
        details: { periodo_id: periodoId, nota: 'nunca va a matchear, cargado antes de usar el sistema' },
      });
    });

    it('a resolved voucher no longer appears as pendiente_en_arca in a later período report', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-03-01' });
      const periodoId = created.body.id;
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca', numero: 999888 });

      await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: arcaId });

      const laterPeriodo = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-04-01' });

      const report = await request(app.getHttpServer())
        .get(`/api/periodos/${laterPeriodo.body.id}/report`)
        .set('Authorization', adminAuth);
      expect(report.status).toBe(200);
      const stillPendiente = report.body.sections.pendientes_en_arca.some(
        (r: { arca: { id: string } | null }) => r.arca?.id === arcaId,
      );
      expect(stillPendiente).toBe(false);
    });

    it('returns 400 when the voucher is not ARCA-side', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-05-01' });
      const periodoId = created.body.id;
      const sistemaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'contabilidad' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: sistemaId });
      expect(res.status).toBe(400);
    });

    it('returns 409 when the voucher is already conciliado', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-06-01' });
      const periodoId = created.body.id;
      const arcaId = await insertVoucher(pool, tenantId, periodoId, { fileSource: 'arca' });

      const first = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: arcaId });
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer())
        .post(`/api/periodos/${periodoId}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: arcaId });
      expect(second.status).toBe(409);
    });

    it('returns 400 for a malformed body (missing arca_voucher_id)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-07-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown período id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos/00000000-0000-0000-0000-000000000000/pendientes-arca-resolver')
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: randomUUID() });
      expect(res.status).toBe(404);
    });

    it('returns 404 when arca_voucher_id does not reference an existing voucher for this tenant', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2029-01-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/pendientes-arca-resolver`)
        .set('Authorization', adminAuth)
        .send({ arca_voucher_id: randomUUID() });
      expect(res.status).toBe(404);
    });
  });

  /**
   * RF-09 — integration coverage for the actual HTTP wiring of
   * POST /api/periodos/:id/marks. feedback_loop's own persistence and
   * periodo-report.ts's attachFeedbackAndReprioritize consumption of it are
   * covered elsewhere; this proves the controller correctly sources the
   * authenticated user id rather than trusting the body.
   */
  describe('POST /api/periodos/:id/marks', () => {
    it('creates a mark using the AUTHENTICATED user id, ignoring any body-supplied user_id', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-07-01' });
      const periodoId = created.body.id;

      const { id: realUserId } = await createTestUser(pool, { role: 'colaborador' });
      const spoofedUserId = randomUUID();
      try {
        const res = await request(app.getHttpServer())
          .post(`/api/periodos/${periodoId}/marks`)
          .set('Authorization', authHeaderFor('colaborador', { sub: realUserId }))
          .send({
            composite_key: '30111111112|1|1|100',
            classification: 'revisado',
            note: 'ya lo revisé con el cliente',
            user_id: spoofedUserId,
          });

        expect(res.status).toBe(201);
        expect(res.body.classification).toBe('revisado');
        expect(res.body.user_id).toBe(realUserId);
        expect(res.body.user_id).not.toBe(spoofedUserId);

        const { rows } = await pool.query(
          'SELECT user_id FROM feedback_loop WHERE tenant_id = $1 AND composite_key = $2',
          [tenantId, '30111111112|1|1|100'],
        );
        expect(rows[0].user_id).toBe(realUserId);
      } finally {
        await deleteTestUser(pool, realUserId);
      }
    });

    it('returns 400 for a malformed body', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2028-08-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/marks`)
        .set('Authorization', adminAuth)
        .send({ classification: 'revisado' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown período id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos/00000000-0000-0000-0000-000000000000/marks')
        .set('Authorization', adminAuth)
        .send({ composite_key: '30111111112|1|1|100', classification: 'revisado' });
      expect(res.status).toBe(404);
    });
  });

  describe('auth (T38, autenticacion-roles)', () => {
    it('POST /api/periodos with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .send({ tenant_id: tenantId, mes: '2026-12-01' });
      expect(res.status).toBe(401);
    });

    it('POST /api/periodos as cliente returns 403 (create is admin/colaborador-only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', authHeaderFor('cliente'))
        .send({ tenant_id: tenantId, mes: '2026-12-01' });
      expect(res.status).toBe(403);
    });

    it('POST /api/periodos/:id/cerrar as cliente returns 403 (cerrar is admin/colaborador-only)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-03-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/cerrar`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({});
      expect(res.status).toBe(403);
    });

    it('GET /api/periodos?tenant_id as a cliente WITHOUT access to that tenant returns 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/periodos?tenant_id=${tenantId}`)
        .set('Authorization', authHeaderFor('cliente'));
      expect(res.status).toBe(403);
    });

    it('GET /api/periodos/:id as a cliente WITH access to the período’s tenant is allowed', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-04-01' });

      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userId, tenantId]);
        const res = await request(app.getHttpServer())
          .get(`/api/periodos/${created.body.id}`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId }));
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('GET /api/periodos/:id as a cliente WITHOUT access to the período’s tenant returns 403, not 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-05-01' });

      const res = await request(app.getHttpServer())
        .get(`/api/periodos/${created.body.id}`)
        .set('Authorization', authHeaderFor('cliente'));
      expect(res.status).toBe(403);
    });

    it('POST /api/periodos/:id/coincidencias with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos/00000000-0000-0000-0000-000000000000/coincidencias')
        .send({ sistema_voucher_id: randomUUID(), arca_voucher_id: randomUUID(), accion: 'confirmar' });
      expect(res.status).toBe(401);
    });

    it('POST /api/periodos/:id/coincidencias as cliente returns 403 (admin/colaborador-only)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-06-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/coincidencias`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({ sistema_voucher_id: randomUUID(), arca_voucher_id: randomUUID(), accion: 'confirmar' });
      expect(res.status).toBe(403);
    });

    it('POST /api/periodos/:id/coincidencias as a cliente WITHOUT access to the tenant returns 403, not 400/404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-07-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/coincidencias`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({ sistema_voucher_id: randomUUID(), arca_voucher_id: randomUUID(), accion: 'confirmar' });
      // role check (cliente is not admin/colaborador) fires before the
      // tenant-access check reached in the coincidencias-only test above —
      // same 403, asserted here for completeness of the auth matrix.
      expect(res.status).toBe(403);
    });

    it('POST /api/periodos/:id/marks with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos/00000000-0000-0000-0000-000000000000/marks')
        .send({ composite_key: '30111111112|1|1|100', classification: 'revisado' });
      expect(res.status).toBe(401);
    });

    it('POST /api/periodos/:id/marks as cliente returns 403 (admin/colaborador-only)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-08-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/marks`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({ composite_key: '30111111112|1|1|100', classification: 'revisado' });
      expect(res.status).toBe(403);
    });

    it('POST /api/periodos/:id/pendientes-arca-resolver with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/periodos/00000000-0000-0000-0000-000000000000/pendientes-arca-resolver')
        .send({ arca_voucher_id: randomUUID() });
      expect(res.status).toBe(401);
    });

    it('POST /api/periodos/:id/pendientes-arca-resolver as cliente returns 403 (admin/colaborador-only)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/periodos')
        .set('Authorization', adminAuth)
        .send({ tenant_id: tenantId, mes: '2027-09-01' });

      const res = await request(app.getHttpServer())
        .post(`/api/periodos/${created.body.id}/pendientes-arca-resolver`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({ arca_voucher_id: randomUUID() });
      expect(res.status).toBe(403);
    });
  });
});
