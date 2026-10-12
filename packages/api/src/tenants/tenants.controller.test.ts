import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import {
  authHeaderFor,
  createTestPeriodo,
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

  describe('2026-08-23 (feature 3 de 3): GET /api/tenants/:id/pendientes-historico', () => {
    it('returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tenants/00000000-0000-0000-0000-000000000000/pendientes-historico')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'tenant not found' });
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
    });
  });

  describe('2026-10-12 (manual ARCA voucher creation): POST /api/tenants/:id/comprobantes-arca', () => {
    function validBody(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        cuit_emisor: '30111111112',
        tipo_cbte: 1,
        punto_venta: Math.floor(Math.random() * 1_000_000),
        numero: Math.floor(Math.random() * 1_000_000),
        fecha_emision: '2026-10-12',
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
        .set('Authorization', authHeaderFor('colaborador'))
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

    it('returns 404 for an unknown tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/tenants/00000000-0000-0000-0000-000000000000/comprobantes-arca')
        .set('Authorization', adminAuth)
        .send(validBody());
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'tenant not found' });
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

    it('a manually created voucher shows up as a normal pendiente in GET /api/tenants/:id/pendientes-historico', async () => {
      const body = validBody({ fecha_emision: '2026-10-12' });
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

    it('GET .../pendientes-historico with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer()).get(`/api/tenants/${tenantId}/pendientes-historico`);
      expect(res.status).toBe(401);
    });

    it('GET .../pendientes-historico as colaborador is allowed (read access is open to all 3 roles)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tenants/${tenantId}/pendientes-historico`)
        .set('Authorization', authHeaderFor('colaborador'));
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
          .set('Authorization', authHeaderFor('cliente', { sub: userId }));
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });
  });
});
