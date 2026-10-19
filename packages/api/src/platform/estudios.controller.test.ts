import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { authHeaderFor, createTestEstudio, deleteTestEstudio, deleteTestUser } from '../test-support/pg-test-helpers';

/**
 * Multi-estudio pivot (PR6/8): integration coverage for
 * GET/POST /api/platform/estudios, PATCH /api/platform/estudios/:id, and
 * POST /api/platform/estudios/:id/invite-admin against the real test
 * Postgres — every route is platform-staff-only (estudio_id === null),
 * the exact mirror of tenants.controller.ts/users.controller.ts's own
 * "platform staff gets 403" tests.
 */
describe('platform self-service: GET/POST /api/platform/estudios, PATCH .../:id, POST .../:id/invite-admin', () => {
  let app: INestApplication;
  let pool: Pool;
  const platformAuth = authHeaderFor('admin', { estudioId: null });
  const createdEstudioIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await deleteTestUser(pool, id);
    }
    for (const id of createdEstudioIds.splice(0)) {
      await deleteTestEstudio(pool, id);
    }
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  function email(prefix: string): string {
    return `${prefix}-${randomUUID()}@example.com`;
  }

  async function createEstudioFixture(name = 'Fixture Estudio'): Promise<string> {
    const id = await createTestEstudio(pool, name);
    createdEstudioIds.push(id);
    return id;
  }

  describe('GET /api/platform/estudios', () => {
    it('lists estudios as platform staff', async () => {
      const estudioId = await createEstudioFixture('List Me Estudio');

      const res = await request(app.getHttpServer()).get('/api/platform/estudios').set('Authorization', platformAuth);
      expect(res.status).toBe(200);
      expect(res.body.some((e: { id: string }) => e.id === estudioId)).toBe(true);
    });

    it("returns 403 for an estudio's own admin (estudio_id set) — platform routes, not estudio routes", async () => {
      const estudioScopedAuth = authHeaderFor('admin', { estudioId: randomUUID() });
      const res = await request(app.getHttpServer()).get('/api/platform/estudios').set('Authorization', estudioScopedAuth);
      expect(res.status).toBe(403);
    });

    it('allows platform-level colaborador, not just admin', async () => {
      const platformColaboradorAuth = authHeaderFor('colaborador', { estudioId: null });
      const res = await request(app.getHttpServer()).get('/api/platform/estudios').set('Authorization', platformColaboradorAuth);
      expect(res.status).toBe(200);
    });

    it('returns 403 for a cliente, platform-level or not', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/platform/estudios')
        .set('Authorization', authHeaderFor('cliente', { estudioId: null }));
      expect(res.status).toBe(403);
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).get('/api/platform/estudios');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/platform/estudios', () => {
    it('creates an estudio, active by default', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/platform/estudios')
        .set('Authorization', platformAuth)
        .send({ name: 'Nuevo Estudio Contable' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Nuevo Estudio Contable', active: true });
      createdEstudioIds.push(res.body.id);
    });

    it('rejects an empty name', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/platform/estudios')
        .set('Authorization', platformAuth)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    it("returns 403 for an estudio's own admin", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/platform/estudios')
        .set('Authorization', authHeaderFor('admin', { estudioId: randomUUID() }))
        .send({ name: 'Should Not Be Created' });
      expect(res.status).toBe(403);
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).post('/api/platform/estudios').send({ name: 'No Auth' });
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/platform/estudios/:id', () => {
    it('disables and re-enables an estudio', async () => {
      const estudioId = await createEstudioFixture();

      const disableRes = await request(app.getHttpServer())
        .patch(`/api/platform/estudios/${estudioId}`)
        .set('Authorization', platformAuth)
        .send({ active: false });
      expect(disableRes.status).toBe(200);
      expect(disableRes.body).toEqual({ id: estudioId, active: false });

      const enableRes = await request(app.getHttpServer())
        .patch(`/api/platform/estudios/${estudioId}`)
        .set('Authorization', platformAuth)
        .send({ active: true });
      expect(enableRes.status).toBe(200);
      expect(enableRes.body).toEqual({ id: estudioId, active: true });
    });

    it('returns 404 for an unknown estudio id', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/platform/estudios/${randomUUID()}`)
        .set('Authorization', platformAuth)
        .send({ active: false });
      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed estudio id', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/platform/estudios/not-a-uuid')
        .set('Authorization', platformAuth)
        .send({ active: false });
      expect(res.status).toBe(400);
    });

    it('returns 400 for a non-boolean active', async () => {
      const estudioId = await createEstudioFixture();
      const res = await request(app.getHttpServer())
        .patch(`/api/platform/estudios/${estudioId}`)
        .set('Authorization', platformAuth)
        .send({ active: 'yes' });
      expect(res.status).toBe(400);
    });

    it("returns 403 for an estudio's own admin", async () => {
      const estudioId = await createEstudioFixture();
      const res = await request(app.getHttpServer())
        .patch(`/api/platform/estudios/${estudioId}`)
        .set('Authorization', authHeaderFor('admin', { estudioId: randomUUID() }))
        .send({ active: false });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/platform/estudios/:id/invite-admin', () => {
    it("invites the estudio's first admin, scoped to that estudio, never leaking the invite token", async () => {
      const estudioId = await createEstudioFixture();

      const res = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${estudioId}/invite-admin`)
        .set('Authorization', platformAuth)
        .send({ email: email('first-admin'), display_name: 'Primer Admin' });
      expect(res.status).toBe(201);
      createdUserIds.push(res.body.id);

      expect(res.body).toMatchObject({ role: 'admin', display_name: 'Primer Admin', is_active: false });
      expect(res.body.invite).toBeUndefined();
      expect(res.body.password_hash).toBeUndefined();

      const { rows } = await pool.query<{ estudio_id: string }>('SELECT estudio_id FROM users WHERE id = $1', [res.body.id]);
      expect(rows[0].estudio_id).toBe(estudioId);
    });

    it('returns 404 for a well-formed but nonexistent estudio id (FK violation translated, not a raw 500)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${randomUUID()}/invite-admin`)
        .set('Authorization', platformAuth)
        .send({ email: email('ghost-estudio') });
      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed estudio id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/platform/estudios/not-a-uuid/invite-admin')
        .set('Authorization', platformAuth)
        .send({ email: email('bad-id') });
      expect(res.status).toBe(400);
    });

    it('returns 400 for a malformed email', async () => {
      const estudioId = await createEstudioFixture();
      const res = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${estudioId}/invite-admin`)
        .set('Authorization', platformAuth)
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('returns 409 for a duplicate email', async () => {
      const estudioId = await createEstudioFixture();
      const duplicateEmail = email('dup-admin');

      const firstRes = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${estudioId}/invite-admin`)
        .set('Authorization', platformAuth)
        .send({ email: duplicateEmail });
      expect(firstRes.status).toBe(201);
      createdUserIds.push(firstRes.body.id);

      const secondRes = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${estudioId}/invite-admin`)
        .set('Authorization', platformAuth)
        .send({ email: duplicateEmail });
      expect(secondRes.status).toBe(409);
    });

    it("returns 403 for an estudio's own admin", async () => {
      const estudioId = await createEstudioFixture();
      const res = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${estudioId}/invite-admin`)
        .set('Authorization', authHeaderFor('admin', { estudioId: randomUUID() }))
        .send({ email: email('forbidden') });
      expect(res.status).toBe(403);
    });

    it('returns 401 with no Authorization header', async () => {
      const estudioId = await createEstudioFixture();
      const res = await request(app.getHttpServer())
        .post(`/api/platform/estudios/${estudioId}/invite-admin`)
        .send({ email: email('noauth') });
      expect(res.status).toBe(401);
    });
  });
});
