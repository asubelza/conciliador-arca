import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { AppModule } from '../app.module';
import {
  authHeaderFor,
  createTestEstudio,
  createTestPeriodo,
  createTestTenant,
  createTestUser,
  deleteTestEstudio,
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
  let estudioId: string;
  let adminAuth: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'tenants.controller.test');
    // Multi-estudio pivot: every other createTestTenant call in this file
    // also omits estudioId, so they all land in the SAME lazily-created,
    // per-file shared estudio (see pg-test-helpers.ts's defaultTestEstudioId)
    // as this first tenant — reading it back here and threading it into
    // every auth token below keeps admin/colaborador/cliente tokens
    // estudio-matched with every tenant fixture in this file.
    const { rows } = await pool.query<{ estudio_id: string }>('SELECT estudio_id FROM tenants WHERE id = $1', [tenantId]);
    estudioId = rows[0].estudio_id;
    adminAuth = authHeaderFor('admin', { estudioId });
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

    it('returns 403, not 404, for an unknown tenant (multi-estudio pivot: assertTenantAccess now requires a real matching row for admin too)', async () => {
      // Pre-pivot, admin unconditionally passed assertTenantAccess and this
      // controller's own tenant-existence check produced a clean 404. Now
      // assertTenantAccess itself requires a REAL tenants row matching the
      // admin's own estudio_id (tenant-access.ts) and intercepts first — a
      // well-formed but nonexistent tenant id behaves the same as any other
      // "not yours" tenant id: 403, never 404 (see tenant-access.ts's doc).
      const res = await request(app.getHttpServer())
        .get('/api/tenants/00000000-0000-0000-0000-000000000000/config')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(403);
    });

    it('returns 400 for a malformed tenant id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/not-a-uuid/config')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant id must be a UUID' });
    });
  });

  describe('backoffice self-service: GET/POST /api/tenants, PUT /api/tenants/:id', () => {
    it('GET /api/tenants lists tenants (includes the one created in beforeAll)', async () => {
      const res = await request(app.getHttpServer()).get('/api/tenants').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((t: { id: string }) => t.id === tenantId)).toBe(true);
    });

    it('GET /api/tenants as colaborador returns 403 (backoffice is admin-only)', async () => {
      const res = await request(app.getHttpServer()).get('/api/tenants').set('Authorization', authHeaderFor('colaborador'));
      expect(res.status).toBe(403);
    });

    it('GET /api/tenants with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/tenants');
      expect(res.status).toBe(401);
    });

    it('POST /api/tenants creates a tenant with name + cuit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', adminAuth)
        .send({ name: 'Backoffice Test Tenant', cuit: '20-11111111-2' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Backoffice Test Tenant', cuit: '20111111112' });
      await deleteTestTenant(pool, res.body.id);
    });

    it('POST /api/tenants allows an omitted cuit (nullable column)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', adminAuth)
        .send({ name: 'Backoffice Test Tenant No Cuit' });
      expect(res.status).toBe(201);
      expect(res.body.cuit).toBeNull();
      await deleteTestTenant(pool, res.body.id);
    });

    it('POST /api/tenants rejects an empty name', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', adminAuth)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('POST /api/tenants rejects a malformed cuit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', adminAuth)
        .send({ name: 'Bad Cuit Tenant', cuit: '123' });
      expect(res.status).toBe(400);
    });

    it('POST /api/tenants as colaborador returns 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', authHeaderFor('colaborador'))
        .send({ name: 'Should Not Be Created' });
      expect(res.status).toBe(403);
    });

    it('PUT /api/tenants/:id updates name + cuit', async () => {
      const editId = await createTestTenant(pool, 'Editable Tenant');
      try {
        const res = await request(app.getHttpServer())
          .put(`/api/tenants/${editId}`)
          .set('Authorization', adminAuth)
          .send({ name: 'Renamed Tenant', cuit: '30111111112' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: editId, name: 'Renamed Tenant', cuit: '30111111112' });
      } finally {
        await deleteTestTenant(pool, editId);
      }
    });

    it('PUT /api/tenants/:id returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/tenants/00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth)
        .send({ name: 'Nobody' });
      expect(res.status).toBe(404);
    });

    it('PUT /api/tenants/:id as colaborador returns 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/tenants/${tenantId}`)
        .set('Authorization', authHeaderFor('colaborador'))
        .send({ name: 'Should Not Rename' });
      expect(res.status).toBe(403);
    });

    describe('multi-estudio pivot: cross-estudio isolation', () => {
      let otherEstudioId: string;
      let otherTenantId: string;

      beforeAll(async () => {
        otherEstudioId = await createTestEstudio(pool, 'tenants.controller.test other estudio');
        otherTenantId = await createTestTenant(pool, 'Other Estudio Tenant', undefined, otherEstudioId);
      });

      afterAll(async () => {
        await deleteTestTenant(pool, otherTenantId);
        await deleteTestEstudio(pool, otherEstudioId);
      });

      it("GET /api/tenants never lists another estudio's tenants", async () => {
        const res = await request(app.getHttpServer()).get('/api/tenants').set('Authorization', adminAuth);
        expect(res.status).toBe(200);
        expect(res.body.some((t: { id: string }) => t.id === otherTenantId)).toBe(false);
      });

      it('GET /api/tenants as platform-level staff (estudio_id null) returns 403', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/tenants')
          .set('Authorization', authHeaderFor('admin', { estudioId: null }));
        expect(res.status).toBe(403);
      });

      it("POST /api/tenants creates the tenant under the caller's OWN estudio_id, never from the body", async () => {
        const res = await request(app.getHttpServer())
          .post('/api/tenants')
          .set('Authorization', adminAuth)
          .send({ name: 'Scoped New Tenant' });
        expect(res.status).toBe(201);

        const { rows } = await pool.query<{ estudio_id: string }>('SELECT estudio_id FROM tenants WHERE id = $1', [
          res.body.id,
        ]);
        expect(rows[0].estudio_id).toBe(estudioId);
        await deleteTestTenant(pool, res.body.id);
      });

      it('POST /api/tenants as platform-level staff (estudio_id null) returns 403', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/tenants')
          .set('Authorization', authHeaderFor('admin', { estudioId: null }))
          .send({ name: 'Should Not Be Created' });
        expect(res.status).toBe(403);
      });

      it("PUT /api/tenants/:id on another estudio's tenant returns 404, not 200 (no cross-estudio mutation)", async () => {
        const res = await request(app.getHttpServer())
          .put(`/api/tenants/${otherTenantId}`)
          .set('Authorization', adminAuth)
          .send({ name: 'Hijacked Name' });
        expect(res.status).toBe(404);

        const { rows } = await pool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [otherTenantId]);
        expect(rows[0].name).toBe('Other Estudio Tenant');
      });

      it("PATCH /api/tenants/:id on another estudio's tenant returns 404, not 200 (no cross-estudio disable/enable)", async () => {
        const res = await request(app.getHttpServer())
          .patch(`/api/tenants/${otherTenantId}`)
          .set('Authorization', adminAuth)
          .send({ active: false });
        expect(res.status).toBe(404);

        const { rows } = await pool.query<{ active: boolean }>('SELECT active FROM tenants WHERE id = $1', [
          otherTenantId,
        ]);
        expect(rows[0].active).toBe(true);
      });
    });
  });

  describe('2026-08-23 (feature 3 de 3): GET /api/tenants/:id/pendientes-historico', () => {
    it('returns 403, not 404, for an unknown tenant (multi-estudio pivot: see tenant-access.ts)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/00000000-0000-0000-0000-000000000000/pendientes-historico')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(403);
    });

    it('returns 400 for a malformed tenant id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/not-a-uuid/pendientes-historico')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tenant id must be a UUID' });
    });

    it('returns the tenant + empty pendientes/excluidos for a freshly created tenant with no vouchers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/pendientes-historico`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.tenant.id).toBe(tenantId);
      expect(res.body.pendientes).toEqual([]);
      expect(res.body.count_pendientes).toBe(0);
      expect(res.body.excluidos_previos_a_alta).toEqual([]);
      expect(res.body.count_excluidos_previos_a_alta).toBe(0);
      expect(res.body.archivados).toEqual([]);
      expect(res.body.count_archivados).toBe(0);
    });
  });

  describe('2026-10-12 (manual ARCA voucher creation): POST /api/tenants/:id/comprobantes-arca', () => {
    function validBody(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        cuit_emisor: '30111111112',
        tipo_cbte: 1,
        punto_venta: Math.floor(Math.random() * 1_000_000),
        numero: Math.floor(Math.random() * 1_000_000),
        // Must stay on-or-after the test tenant's created_at (set to `now()`
        // by createTestTenant) or fetchPendientesHistorico buckets it into
        // excluidos_previos_a_alta instead of pendientes — a hardcoded past
        // date here is a time bomb that breaks once "today" moves past it.
        fecha_emision: new Date().toISOString().slice(0, 10),
        importe_total_ars: 1000,
        iva: 210,
        ...overrides,
      };
    }

    it('creates a pendiente ARCA voucher as admin, with periodo_alta_id null when the tenant has no abierto período', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(validBody());
      expect(res.status).toBe(201);
      expect(res.body.estado).toBe('pendiente');
      expect(res.body.file_source).toBe('arca');
      expect(res.body.periodo_alta_id).toBeNull();
      expect(res.body.id).toBeDefined();
    });

    it('creates a voucher as colaborador', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', authHeaderFor('colaborador', { estudioId }))
        .send(validBody());
      expect(res.status).toBe(201);
      expect(res.body.estado).toBe('pendiente');
    });

    it('returns 403 for a cliente (role check runs before any DB write)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', authHeaderFor('cliente'))
        .send(validBody());
      expect(res.status).toBe(403);
    });

    it('resolves periodo_alta_id to the tenant\'s currently abierto período', async () => {
      const abiertoTenantId = await createTestTenant(pool, 'comprobantes-arca.test (abierto)');
      try {
        const periodoId = await createTestPeriodo(pool, abiertoTenantId, '2026-10-01');
        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${abiertoTenantId}/comprobantes-arca`)
          .set('Authorization', adminAuth)
          .send(validBody());
        expect(res.status).toBe(201);
        expect(res.body.periodo_alta_id).toBe(periodoId);
      } finally {
        await deleteTestTenant(pool, abiertoTenantId);
      }
    });

    it('returns 400 for a missing tipo_cbte', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(validBody({ tipo_cbte: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tipo_cbte/);
    });

    it('returns 400 for an unrecognized tipo_cbte code', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(validBody({ tipo_cbte: 999 }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tipo_cbte/);
    });

    it('returns 400 for a malformed cuit_emisor', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(validBody({ cuit_emisor: '123' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cuit_emisor/);
    });

    it('returns 400 for a missing fecha_emision', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(validBody({ fecha_emision: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/fecha_emision/);
    });

    it('returns 400 for a non-numeric importe_total_ars', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(validBody({ importe_total_ars: 'lots' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/importe_total_ars/);
    });

    it('returns 403, not 404, for an unknown tenant (multi-estudio pivot: see tenant-access.ts)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants/00000000-0000-0000-0000-000000000000/comprobantes-arca')
        .set('Authorization', adminAuth)
        .send(validBody());
      expect(res.status).toBe(403);
    });

    it('returns 409 when a conciliado voucher already exists with the same composite key, instead of a false success', async () => {
      const body = validBody();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           iva, fecha, file_source, estado, periodo_alta_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'arca', 'conciliado', NULL)
         RETURNING id`,
        [tenantId, body.cuit_emisor, body.tipo_cbte, body.punto_venta, body.numero, body.importe_total_ars, body.iva, body.fecha_emision],
      );

      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(body);
      expect(res.status).toBe(409);

      // the pre-existing conciliado row must be untouched (still conciliado, no new row inserted)
      const { rows: afterRows } = await pool.query('SELECT id, estado FROM vouchers_canonical WHERE id = $1', [rows[0].id]);
      expect(afterRows[0].estado).toBe('conciliado');
    });

    it('returns a 409 naming "archivado" (not "conciliado") when the blocking row is archivado', async () => {
      const body = validBody();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           iva, fecha, file_source, estado, periodo_alta_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'arca', 'archivado', NULL)
         RETURNING id`,
        [tenantId, body.cuit_emisor, body.tipo_cbte, body.punto_venta, body.numero, body.importe_total_ars, body.iva, body.fecha_emision],
      );

      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('archivado');

      const { rows: afterRows } = await pool.query('SELECT id, estado FROM vouchers_canonical WHERE id = $1', [rows[0].id]);
      expect(afterRows[0].estado).toBe('archivado');
    });

    it('a manually created voucher shows up as a normal pendiente in GET /api/tenants/:id/pendientes-historico', async () => {
      const body = validBody();
      const createRes = await request(app.getHttpServer())
        .post(`/api/tenants/${tenantId}/comprobantes-arca`)
        .set('Authorization', adminAuth)
        .send(body);
      expect(createRes.status).toBe(201);

      const historicoRes = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/pendientes-historico`)
        .set('Authorization', adminAuth);
      expect(historicoRes.status).toBe(200);
      const ids = historicoRes.body.pendientes.map((r: { id: string }) => r.id);
      expect(ids).toContain(createRes.body.id);
    });
  });

  /**
   * 2026-10-12 (Histórico filters + "Archivar"): both archive endpoints get
   * their own dedicated tenant (not the shared `tenantId` above) so vouchers
   * inserted directly by these tests never leak into the pendientes-historico
   * or comprobantes-arca assertions elsewhere in this file.
   */
  describe('2026-10-12 (Histórico filters + "Archivar"): POST .../comprobantes/:voucherId/archivar', () => {
    let archivarTenantId: string;

    beforeAll(async () => {
      archivarTenantId = await createTestTenant(pool, 'tenants.controller.test (archivar)');
    });

    afterAll(async () => {
      await deleteTestTenant(pool, archivarTenantId);
    });

    async function insertVoucher(overrides: {
      fileSource?: 'arca' | 'contabilidad';
      estado?: 'pendiente' | 'conciliado' | 'archivado';
      tenantId?: string;
    } = {}): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           file_source, estado, periodo_alta_id
         ) VALUES ($1, '30111111112', 1, $2, $3, 1000, $4, $5, NULL)
         RETURNING id`,
        [
          overrides.tenantId ?? archivarTenantId,
          Math.floor(Math.random() * 1_000_000),
          Math.floor(Math.random() * 1_000_000),
          overrides.fileSource ?? 'arca',
          overrides.estado ?? 'pendiente',
        ],
      );
      return rows[0].id;
    }

    it('archives a pendiente ARCA voucher as admin', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', adminAuth)
        .send({ nota: 'ya no corresponde' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: voucherId, estado: 'archivado' });

      const { rows } = await pool.query('SELECT estado FROM vouchers_canonical WHERE id = $1', [voucherId]);
      expect(rows[0].estado).toBe('archivado');
    });

    it('archives as colaborador', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', authHeaderFor('colaborador', { estudioId }))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('archivado');
    });

    it('returns 403 for a cliente (role check runs before any DB write)', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({});
      expect(res.status).toBe(403);

      const { rows } = await pool.query('SELECT estado FROM vouchers_canonical WHERE id = $1', [voucherId]);
      expect(rows[0].estado).toBe('pendiente');
    });

    it('returns 404 for a voucher that does not belong to this tenant', async () => {
      const otherTenantId = await createTestTenant(pool, 'tenants.controller.test (archivar, other tenant)');
      try {
        const voucherId = await insertVoucher({ tenantId: otherTenantId });
        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
          .set('Authorization', adminAuth)
          .send({});
        expect(res.status).toBe(404);
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 404 for an unknown voucher id', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/00000000-0000-0000-0000-000000000000/archivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(404);
    });

    it('returns 400 for a contabilidad-side voucher (archivar only applies to ARCA)', async () => {
      const voucherId = await insertVoucher({ fileSource: 'contabilidad' });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 409 for an already-conciliado voucher, naming the state in the message', async () => {
      const voucherId = await insertVoucher({ estado: 'conciliado' });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/conciliado/);
    });

    it('returns 409 for an already-archivado voucher, naming the state in the message', async () => {
      const voucherId = await insertVoucher({ estado: 'archivado' });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/archivado/);
    });

    it('returns 400 for a malformed voucher id', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/not-a-uuid/archivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(400);
    });

    it('an archived voucher shows up in the archivados bucket of GET .../pendientes-historico, not pendientes', async () => {
      const voucherId = await insertVoucher();
      await request(app.getHttpServer())
        .post(`/api/tenants/${archivarTenantId}/comprobantes/${voucherId}/archivar`)
        .set('Authorization', adminAuth)
        .send({});

      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${archivarTenantId}/pendientes-historico`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.archivados.map((r: { id: string }) => r.id)).toContain(voucherId);
      expect(res.body.pendientes.map((r: { id: string }) => r.id)).not.toContain(voucherId);
    });
  });

  describe('2026-10-12 ("Match manual" para no_existe_en_arca): POST .../comprobantes/:voucherId/desarchivar', () => {
    let desarchivarTenantId: string;

    beforeAll(async () => {
      desarchivarTenantId = await createTestTenant(pool, 'tenants.controller.test (desarchivar)');
    });

    afterAll(async () => {
      await deleteTestTenant(pool, desarchivarTenantId);
    });

    async function insertVoucher(overrides: {
      fileSource?: 'arca' | 'contabilidad';
      estado?: 'pendiente' | 'conciliado' | 'archivado';
      tenantId?: string;
      fecha?: string;
    } = {}): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           file_source, estado, periodo_alta_id, fecha
         ) VALUES ($1, '30111111112', 1, $2, $3, 1000, $4, $5, NULL, $6)
         RETURNING id`,
        [
          overrides.tenantId ?? desarchivarTenantId,
          Math.floor(Math.random() * 1_000_000),
          Math.floor(Math.random() * 1_000_000),
          overrides.fileSource ?? 'arca',
          overrides.estado ?? 'archivado',
          // 2099-01-01: safely >= this freshly-created tenant's alta date,
          // so a desarchived voucher lands in the `pendientes` bucket (not
          // `excluidos_previos_a_alta` — see pendientes-historico.ts's doc
          // on rows with no/old fecha) when a test checks for that.
          overrides.fecha ?? '2099-01-01',
        ],
      );
      return rows[0].id;
    }

    it('desarchives an archivado voucher as admin, back to pendiente', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: voucherId, estado: 'pendiente' });

      const { rows } = await pool.query('SELECT estado FROM vouchers_canonical WHERE id = $1', [voucherId]);
      expect(rows[0].estado).toBe('pendiente');
    });

    it('desarchives as colaborador', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
        .set('Authorization', authHeaderFor('colaborador', { estudioId }))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('pendiente');
    });

    it('returns 403 for a cliente (role check runs before any DB write)', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({});
      expect(res.status).toBe(403);

      const { rows } = await pool.query('SELECT estado FROM vouchers_canonical WHERE id = $1', [voucherId]);
      expect(rows[0].estado).toBe('archivado');
    });

    it('returns 404 for a voucher that does not belong to this tenant', async () => {
      const otherTenantId = await createTestTenant(pool, 'tenants.controller.test (desarchivar, other tenant)');
      try {
        const voucherId = await insertVoucher({ tenantId: otherTenantId });
        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
          .set('Authorization', adminAuth)
          .send({});
        expect(res.status).toBe(404);
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 404 for an unknown voucher id', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/00000000-0000-0000-0000-000000000000/desarchivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(404);
    });

    it('returns 409 for a voucher that is still pendiente, naming the state in the message', async () => {
      const voucherId = await insertVoucher({ estado: 'pendiente' });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/pendiente/);
    });

    it('returns 409 for an already-conciliado voucher, naming the state in the message', async () => {
      const voucherId = await insertVoucher({ estado: 'conciliado' });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/conciliado/);
    });

    it('returns 400 for a malformed voucher id', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/not-a-uuid/desarchivar`)
        .set('Authorization', adminAuth)
        .send({});
      expect(res.status).toBe(400);
    });

    it('a desarchived voucher shows up in the pendientes bucket of GET .../pendientes-historico, not archivados', async () => {
      const voucherId = await insertVoucher();
      await request(app.getHttpServer())
        .post(`/api/tenants/${desarchivarTenantId}/comprobantes/${voucherId}/desarchivar`)
        .set('Authorization', adminAuth)
        .send({});

      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${desarchivarTenantId}/pendientes-historico`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body.pendientes.map((r: { id: string }) => r.id)).toContain(voucherId);
      expect(res.body.archivados.map((r: { id: string }) => r.id)).not.toContain(voucherId);
    });
  });

  describe('2026-10-12 (Histórico filters + "Archivar"): POST .../comprobantes/archivar-lote', () => {
    let loteTenantId: string;

    beforeAll(async () => {
      loteTenantId = await createTestTenant(pool, 'tenants.controller.test (archivar-lote)');
    });

    afterAll(async () => {
      await deleteTestTenant(pool, loteTenantId);
    });

    async function insertVoucher(overrides: {
      fileSource?: 'arca' | 'contabilidad';
      estado?: 'pendiente' | 'conciliado' | 'archivado';
      tenantId?: string;
    } = {}): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           file_source, estado, periodo_alta_id
         ) VALUES ($1, '30111111112', 1, $2, $3, 1000, $4, $5, NULL)
         RETURNING id`,
        [
          overrides.tenantId ?? loteTenantId,
          Math.floor(Math.random() * 1_000_000),
          Math.floor(Math.random() * 1_000_000),
          overrides.fileSource ?? 'arca',
          overrides.estado ?? 'pendiente',
        ],
      );
      return rows[0].id;
    }

    it('archives valid ids and reports a per-id skip reason for the rest, in one call', async () => {
      const validId = await insertVoucher();
      const alreadyArchivadoId = await insertVoucher({ estado: 'archivado' });
      const alreadyConciliadoId = await insertVoucher({ estado: 'conciliado' });
      const wrongFileSourceId = await insertVoucher({ fileSource: 'contabilidad' });
      const otherTenantId = await createTestTenant(pool, 'tenants.controller.test (archivar-lote, other tenant)');
      let wrongTenantId: string;
      const unknownId = '00000000-0000-0000-0000-000000000000';
      try {
        wrongTenantId = await insertVoucher({ tenantId: otherTenantId });

        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${loteTenantId}/comprobantes/archivar-lote`)
          .set('Authorization', adminAuth)
          .send({
            voucher_ids: [validId, alreadyArchivadoId, alreadyConciliadoId, wrongFileSourceId, wrongTenantId, unknownId],
            nota: 'limpieza histórico',
          });

        expect(res.status).toBe(200);
        const byId = new Map(res.body.results.map((r: { voucher_id: string }) => [r.voucher_id, r]));
        expect(byId.get(validId)).toEqual({ voucher_id: validId, status: 'archived' });
        expect(byId.get(alreadyArchivadoId)).toEqual({ voucher_id: alreadyArchivadoId, status: 'skipped', reason: 'already_archivado' });
        expect(byId.get(alreadyConciliadoId)).toEqual({ voucher_id: alreadyConciliadoId, status: 'skipped', reason: 'already_conciliado' });
        expect(byId.get(wrongFileSourceId)).toEqual({ voucher_id: wrongFileSourceId, status: 'skipped', reason: 'wrong_file_source' });
        expect(byId.get(wrongTenantId)).toEqual({ voucher_id: wrongTenantId, status: 'skipped', reason: 'wrong_tenant' });
        expect(byId.get(unknownId)).toEqual({ voucher_id: unknownId, status: 'skipped', reason: 'not_found' });

        // the valid one actually got archived; every skipped one is untouched
        const { rows } = await pool.query(
          'SELECT id, estado FROM vouchers_canonical WHERE id = ANY($1::uuid[])',
          [[validId, alreadyArchivadoId, alreadyConciliadoId, wrongFileSourceId, wrongTenantId]],
        );
        const estadoById = new Map(rows.map((r) => [r.id, r.estado]));
        expect(estadoById.get(validId)).toBe('archivado');
        expect(estadoById.get(alreadyArchivadoId)).toBe('archivado');
        expect(estadoById.get(alreadyConciliadoId)).toBe('conciliado');
        expect(estadoById.get(wrongFileSourceId)).toBe('pendiente');
        expect(estadoById.get(wrongTenantId)).toBe('pendiente');
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 403 for a cliente', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${loteTenantId}/comprobantes/archivar-lote`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({ voucher_ids: [voucherId] });
      expect(res.status).toBe(403);
    });

    it('returns 400 for an empty voucher_ids array', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${loteTenantId}/comprobantes/archivar-lote`)
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [] });
      expect(res.status).toBe(400);
    });

    it('returns 400 for a voucher_ids entry that is not a UUID', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${loteTenantId}/comprobantes/archivar-lote`)
        .set('Authorization', adminAuth)
        .send({ voucher_ids: ['not-a-uuid'] });
      expect(res.status).toBe(400);
    });

    it('returns 403, not 404, for an unknown tenant (multi-estudio pivot: see tenant-access.ts)', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post('/api/tenants/00000000-0000-0000-0000-000000000000/comprobantes/archivar-lote')
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [voucherId] });
      expect(res.status).toBe(403);
    });
  });

  /**
   * 2026-10-12 (Histórico filters + export): PendientesHistoricoViewer.tsx's
   * "Descargar Excel/CSV" buttons — exports exactly the `voucher_ids` the
   * caller sends, no matter which of the 3 Histórico buckets they came
   * from. Own dedicated tenant, same reasoning as the archivar/desarchivar
   * blocks above.
   */
  describe('2026-10-12 (Histórico filters + export): POST .../pendientes-historico/export', () => {
    let exportTenantId: string;

    beforeAll(async () => {
      exportTenantId = await createTestTenant(pool, 'tenants.controller.test (export)');
    });

    afterAll(async () => {
      await deleteTestTenant(pool, exportTenantId);
    });

    async function insertVoucher(overrides: {
      fileSource?: 'arca' | 'contabilidad';
      estado?: 'pendiente' | 'conciliado' | 'archivado';
      tenantId?: string;
      cuit?: string;
      importe?: number;
      iva?: number;
      fecha?: string | null;
    } = {}): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           iva, fecha, file_source, estado, periodo_alta_id
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, NULL)
         RETURNING id`,
        [
          overrides.tenantId ?? exportTenantId,
          overrides.cuit ?? '30111111112',
          Math.floor(Math.random() * 1_000_000),
          Math.floor(Math.random() * 1_000_000),
          overrides.importe ?? 1000,
          overrides.iva ?? 210,
          overrides.fecha === undefined ? '2026-10-01' : overrides.fecha,
          overrides.fileSource ?? 'arca',
          overrides.estado ?? 'pendiente',
        ],
      );
      return rows[0].id;
    }

    it('exports an xlsx file with the correct headers and the requested rows', async () => {
      const voucherId = await insertVoucher({ cuit: '30111111112', importe: 1234.5 });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [voucherId], format: 'xlsx' })
        .buffer(true)
        .parse((parseRes, cb) => {
          const chunks: Buffer[] = [];
          parseRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          parseRes.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain(`pendientes-historico-${exportTenantId}.xlsx`);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      const sheet = workbook.worksheets[0];
      expect(sheet.getRow(1).getCell(1).value).toBe('CUIT Emisor');
      expect(sheet.getRow(2).getCell(1).value).toBe('30111111112');
      expect(sheet.getRow(2).getCell(6).value).toBe(1234.5);
    });

    it('exports a csv file with the correct headers and the requested row', async () => {
      const voucherId = await insertVoucher({ cuit: '30222222223', importe: 500 });
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [voucherId], format: 'csv' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain(`pendientes-historico-${exportTenantId}.csv`);
      const csv = res.text;
      const lines = csv.trim().split('\n');
      expect(lines[0]).toBe('cuit_emisor,tipo_cbte,punto_venta,numero,fecha,importe_total,iva,estado,antiguedad_meses');
      expect(lines[1]).toContain('30222222223');
      expect(lines[1]).toContain('500.00');
    });

    it('silently excludes ids that are invalid/wrong-tenant/unknown, keeping the valid ones', async () => {
      const validId = await insertVoucher({ cuit: '30333333334' });
      const otherTenantId = await createTestTenant(pool, 'tenants.controller.test (export, other tenant)');
      try {
        const wrongTenantId = await insertVoucher({ tenantId: otherTenantId });
        const unknownId = '00000000-0000-0000-0000-000000000000';

        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
          .set('Authorization', adminAuth)
          .send({ voucher_ids: [validId, wrongTenantId, unknownId], format: 'csv' });

        expect(res.status).toBe(200);
        const lines = res.text.trim().split('\n');
        expect(lines).toHaveLength(2); // header + only the valid row
        expect(lines[1]).toContain('30333333334');
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 400 for an empty voucher_ids array', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [], format: 'xlsx' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid format value', async () => {
      const voucherId = await insertVoucher();
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [voucherId], format: 'pdf' });
      expect(res.status).toBe(400);
    });

    it('returns 403 for a nonexistent tenant id (multi-estudio pivot: admin no longer always passes assertTenantAccess — see tenant-access.ts)', async () => {
      // Pre-pivot, admin unconditionally passed assertTenantAccess, so this
      // route's lack of its own separate tenant-existence check meant a
      // bogus tenant id silently exported an empty file. Now
      // assertTenantAccess itself requires a real matching tenants row for
      // admin too, and rejects with 403 before this handler's own logic
      // ever runs.
      const voucherId = await insertVoucher(); // belongs to exportTenantId, not the bogus id below
      const res = await request(app.getHttpServer())
        .post('/api/tenants/00000000-0000-0000-0000-000000000000/pendientes-historico/export')
        .set('Authorization', adminAuth)
        .send({ voucher_ids: [voucherId], format: 'csv' });
      expect(res.status).toBe(403);
    });

    it('is allowed for a cliente with access (read/export posture, same as GET .../pendientes-historico)', async () => {
      const voucherId = await insertVoucher();
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userId, exportTenantId]);
        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId, estudioId }))
          .send({ voucher_ids: [voucherId], format: 'csv' });
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('returns 403 for a cliente WITHOUT access to this tenant', async () => {
      const voucherId = await insertVoucher();
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        const res = await request(app.getHttpServer())
          .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId }))
          .send({ voucher_ids: [voucherId], format: 'csv' });
        expect(res.status).toBe(403);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tenants/${exportTenantId}/pendientes-historico/export`)
        .send({ voucher_ids: ['00000000-0000-0000-0000-000000000000'], format: 'csv' });
      expect(res.status).toBe(401);
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

    it('returns 403, not 404, for an unknown tenant (multi-estudio pivot: see tenant-access.ts)', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/tenants/00000000-0000-0000-0000-000000000000/config')
        .set('Authorization', adminAuth)
        .send({ tolerancia_redondeo_ars: 1, tolerancia_dias_fecha: 5 });
      expect(res.status).toBe(403);
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
        .set('Authorization', authHeaderFor('colaborador', { estudioId }));
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
          .set('Authorization', authHeaderFor('cliente', { sub: userId, estudioId }));
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('GET .../pendientes-historico with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/pendientes-historico`);
      expect(res.status).toBe(401);
    });

    it('GET .../pendientes-historico as colaborador is allowed (read access is open to all 3 roles)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/pendientes-historico`)
        .set('Authorization', authHeaderFor('colaborador', { estudioId }));
      expect(res.status).toBe(200);
    });

    it('GET .../pendientes-historico as a cliente WITHOUT user_tenant_access for this tenant returns 403', async () => {
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/tenants/${tenantId}/pendientes-historico`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId }));
        expect(res.status).toBe(403);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('GET .../pendientes-historico as a cliente WITH user_tenant_access for this tenant is allowed', async () => {
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userId, tenantId]);
        const res = await request(app.getHttpServer())
          .get(`/api/tenants/${tenantId}/pendientes-historico`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId, estudioId }));
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });
  });
});
