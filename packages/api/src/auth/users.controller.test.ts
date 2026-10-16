import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { authHeaderFor, createTestTenant, createTestUser, deleteTestTenant, deleteTestUser } from '../test-support/pg-test-helpers';

/**
 * Backoffice self-service (invitación por email): integration coverage for
 * GET/POST /api/users and PATCH /api/users/:id against the real test
 * Postgres — all 3 admin-only, same posture as the tenants backoffice
 * routes from PR1 (tenants.controller.test.ts).
 */
describe('backoffice self-service: GET/POST /api/users, PATCH /api/users/:id', () => {
  let app: INestApplication;
  let pool: Pool;
  const adminAuth = authHeaderFor('admin');
  const colaboradorAuth = authHeaderFor('colaborador');
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
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  function email(prefix: string): string {
    return `${prefix}-${randomUUID()}@example.com`;
  }

  describe('GET /api/users', () => {
    it('lists users as admin, each with a tenant_ids array and no password_hash/invite token leaked', async () => {
      const user = await createTestUser(pool);
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer()).get('/api/users').set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      const found = res.body.find((u: { id: string }) => u.id === user.id);
      expect(found).toMatchObject({ id: user.id, email: user.email, tenant_ids: [] });
      expect(found.password_hash).toBeUndefined();
    });

    it('returns 403 as colaborador', async () => {
      const res = await request(app.getHttpServer()).get('/api/users').set('Authorization', colaboradorAuth);
      expect(res.status).toBe(403);
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).get('/api/users');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/users', () => {
    it('creates an admin and never leaks the invite token or password_hash in the response', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: email('new-admin'), role: 'admin', display_name: 'Nuevo Admin' });

      expect(res.status).toBe(201);
      createdUserIds.push(res.body.id);
      expect(res.body).toMatchObject({ role: 'admin', display_name: 'Nuevo Admin', is_active: false });
      expect(res.body.invite).toBeUndefined();
      expect(res.body.password_hash).toBeUndefined();
    });

    it('creates a cliente with tenant_ids, written to user_tenant_access', async () => {
      const tenantId = await createTestTenant(pool, 'users.controller.test tenant');
      try {
        const res = await request(app.getHttpServer())
          .post('/api/users')
          .set('Authorization', adminAuth)
          .send({ email: email('new-cliente'), role: 'cliente', tenant_ids: [tenantId] });

        expect(res.status).toBe(201);
        createdUserIds.push(res.body.id);

        const { rows } = await pool.query('SELECT tenant_id FROM user_tenant_access WHERE user_id = $1', [res.body.id]);
        expect(rows).toEqual([{ tenant_id: tenantId }]);
      } finally {
        await deleteTestTenant(pool, tenantId);
      }
    });

    it('returns 400 for a cliente with a well-formed but nonexistent tenant_id (FK violation translated, not a raw 500)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: email('ghost-tenant'), role: 'cliente', tenant_ids: [randomUUID()] });
      expect(res.status).toBe(400);
    });

    it('deduplicates a repeated tenant_id instead of hitting user_tenant_access\'s PK and misreporting it as a duplicate email (409)', async () => {
      const tenantId = await createTestTenant(pool, 'users.controller.test dedup tenant');
      try {
        const res = await request(app.getHttpServer())
          .post('/api/users')
          .set('Authorization', adminAuth)
          .send({ email: email('dedup-cliente'), role: 'cliente', tenant_ids: [tenantId, tenantId] });

        expect(res.status).toBe(201);
        createdUserIds.push(res.body.id);

        const { rows } = await pool.query('SELECT tenant_id FROM user_tenant_access WHERE user_id = $1', [res.body.id]);
        expect(rows).toEqual([{ tenant_id: tenantId }]);
      } finally {
        await deleteTestTenant(pool, tenantId);
      }
    });

    it('rejects a cliente with no tenant_ids (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: email('bad-cliente'), role: 'cliente' });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed email (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: 'not-an-email', role: 'admin' });
      expect(res.status).toBe(400);
    });

    it('returns 409 for a duplicate email', async () => {
      const duplicateEmail = email('dup');
      const firstRes = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: duplicateEmail, role: 'admin' });
      expect(firstRes.status).toBe(201);
      createdUserIds.push(firstRes.body.id);

      const secondRes = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: duplicateEmail, role: 'admin' });
      expect(secondRes.status).toBe(409);
    });

    it('returns 403 as colaborador (user creation is admin-only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', colaboradorAuth)
        .send({ email: email('forbidden'), role: 'admin' });
      expect(res.status).toBe(403);
    });

    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).post('/api/users').send({ email: email('noauth'), role: 'admin' });
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('deactivates an active user', async () => {
      const user = await createTestUser(pool, { isActive: true });
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${user.id}`)
        .set('Authorization', adminAuth)
        .send({ is_active: false });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, is_active: false });
    });

    it('reactivates a deactivated user', async () => {
      const user = await createTestUser(pool, { isActive: false });
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${user.id}`)
        .set('Authorization', adminAuth)
        .send({ is_active: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, is_active: true });
    });

    it('returns 409 when activating a user created via POST /api/users who never accepted their invite', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', adminAuth)
        .send({ email: email('never-onboarded'), role: 'admin' });
      createdUserIds.push(createRes.body.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${createRes.body.id}`)
        .set('Authorization', adminAuth)
        .send({ is_active: true });
      expect(res.status).toBe(409);
    });

    it('returns 400 for a non-boolean is_active', async () => {
      const user = await createTestUser(pool);
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${user.id}`)
        .set('Authorization', adminAuth)
        .send({ is_active: 'yes' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown user id', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/users/${randomUUID()}`)
        .set('Authorization', adminAuth)
        .send({ is_active: false });
      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed user id', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/users/not-a-uuid')
        .set('Authorization', adminAuth)
        .send({ is_active: false });
      expect(res.status).toBe(400);
    });

    it('returns 403 as colaborador', async () => {
      const user = await createTestUser(pool);
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/users/${user.id}`)
        .set('Authorization', colaboradorAuth)
        .send({ is_active: false });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/users/:id/resend-invite', () => {
    it('mints a fresh invite for an inactive user and returns invite_email_sent (false — no Resend configured in tests)', async () => {
      const user = await createTestUser(pool, { isActive: false });
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer()).post(`/api/users/${user.id}/resend-invite`).set('Authorization', adminAuth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ email: user.email, invite_email_sent: false });

      const { rows } = await pool.query('SELECT id FROM user_invites WHERE user_id = $1', [user.id]);
      expect(rows).toHaveLength(1);
    });

    it('returns 409 for an already-active user', async () => {
      const user = await createTestUser(pool, { isActive: true });
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer()).post(`/api/users/${user.id}/resend-invite`).set('Authorization', adminAuth);
      expect(res.status).toBe(409);
    });

    it('returns 404 for an unknown user id', async () => {
      const res = await request(app.getHttpServer()).post(`/api/users/${randomUUID()}/resend-invite`).set('Authorization', adminAuth);
      expect(res.status).toBe(404);
    });

    it('returns 403 as colaborador', async () => {
      const user = await createTestUser(pool, { isActive: false });
      createdUserIds.push(user.id);

      const res = await request(app.getHttpServer()).post(`/api/users/${user.id}/resend-invite`).set('Authorization', colaboradorAuth);
      expect(res.status).toBe(403);
    });
  });
});
