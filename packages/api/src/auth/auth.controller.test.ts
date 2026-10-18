import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createTestUser, deleteTestUser, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';
import { signToken } from './jwt';
import { hashInviteToken } from './invite-tokens';

/**
 * T35/T36 — integration coverage for the real HTTP wiring of
 * POST /api/auth/login and the AuthGuard (proven via GET /api/auth/me,
 * the one endpoint that uses it in Fase 1 — every other controller gets
 * protected in Fase 2).
 */
describe('T35/T36: /api/auth (integration)', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/auth/login', () => {
    it('a correct email/password returns 200 with a token and the user (no password_hash leaked)', async () => {
      const { id, email, password } = await createTestUser(pool, { role: 'colaborador' });
      try {
        const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe('string');
        expect(res.body.user).toEqual({ id, email, role: 'colaborador', display_name: null });
        expect(res.body.user.password_hash).toBeUndefined();
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('wrong password returns 401', async () => {
      const { id, email } = await createTestUser(pool, { password: 'right-one' });
      try {
        const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'wrong-one' });
        expect(res.status).toBe(401);
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('returns 400 for a missing password', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'a@b.com' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me (AuthGuard)', () => {
    it('a valid token returns the authenticated user', async () => {
      const { id, email, password } = await createTestUser(pool, { role: 'admin' });
      try {
        const loginRes = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
        const res = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${loginRes.body.token}`);
        expect(res.status).toBe(200);
        expect(res.body.user).toEqual({ id, email, role: 'admin' });
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('returns 401 with no Authorization header at all', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 for a malformed/garbage token', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('returns 401 for a well-formed but forged token (wrong secret)', async () => {
      const jwt = await import('jsonwebtoken');
      const forged = jwt.sign({ sub: 'x', role: 'admin', email: 'x@y.com' }, 'wrong-secret');
      const res = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects a deactivated user trying to log in even before the guard is involved', async () => {
      // Belt-and-suspenders: a token can only exist for someone who
      // successfully logged in, and login already refuses is_active=false
      // (auth.service.test.ts) — this proves the controller-level flow
      // agrees, not just the service function in isolation.
      const { id, email, password } = await createTestUser(pool, { isActive: false });
      try {
        const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
        expect(res.status).toBe(401);
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('a token for a user deactivated AFTER the token was issued still passes the guard (documented limitation, not a bug)', async () => {
      // The AuthGuard only verifies the JWT signature/expiry — it doesn't
      // hit the DB on every request (that would defeat the point of a
      // stateless token). A 12h-old token from a since-deactivated user
      // stays valid until it expires. Acceptable for this phase (internal
      // tool, single estudio) and documented here rather than silently
      // assumed; revisit with a shorter expiry + refresh flow if this
      // needs tightening later.
      const { id } = await createTestUser(pool, { role: 'cliente' });
      try {
        const token = signToken({ sub: id, role: 'cliente', email: 'whatever@example.com' });
        await pool.query('UPDATE users SET is_active = false WHERE id = $1', [id]);
        const res = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, id);
      }
    });
  });

  describe('GET /api/auth/me/tenants (tenant-discovery)', () => {
    it('returns 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me/tenants');
      expect(res.status).toBe(401);
    });

    it('admin gets every tenant, as a plain array of {id, name}', async () => {
      const tenantId = await createTestTenant(pool, 'Integration Admin Co');
      const { id, email, password } = await createTestUser(pool, { role: 'admin' });
      try {
        const loginRes = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
        const res = await request(app.getHttpServer())
          .get('/api/auth/me/tenants')
          .set('Authorization', `Bearer ${loginRes.body.token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toEqual(expect.arrayContaining([{ id: tenantId, name: 'Integration Admin Co' }]));
      } finally {
        await deleteTestUser(pool, id);
        await deleteTestTenant(pool, tenantId);
      }
    });

    it('cliente only gets their own active tenants', async () => {
      const ownTenantId = await createTestTenant(pool, 'Integration Own Co');
      const otherTenantId = await createTestTenant(pool, 'Integration Other Co');
      const { id, email, password } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [id, ownTenantId]);
        const loginRes = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
        const res = await request(app.getHttpServer())
          .get('/api/auth/me/tenants')
          .set('Authorization', `Bearer ${loginRes.body.token}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: ownTenantId, name: 'Integration Own Co' }]);
      } finally {
        await deleteTestUser(pool, id);
        await deleteTestTenant(pool, ownTenantId);
        await deleteTestTenant(pool, otherTenantId);
      }
    });
  });

  describe('GET /api/auth/invite/:token + POST /api/auth/accept-invite (backoffice self-service, no guard)', () => {
    async function insertInvite(userId: string, overrides: { expiresInMs?: number; consumedAt?: Date } = {}): Promise<string> {
      const rawToken = randomBytes(32).toString('hex');
      await pool.query('INSERT INTO user_invites (user_id, token_hash, expires_at, consumed_at) VALUES ($1, $2, $3, $4)', [
        userId,
        hashInviteToken(rawToken),
        new Date(Date.now() + (overrides.expiresInMs ?? 7 * 24 * 60 * 60 * 1000)),
        overrides.consumedAt ?? null,
      ]);
      return rawToken;
    }

    it('GET /api/auth/invite/:token returns the invited email for a valid invite, no Authorization header needed', async () => {
      const { id } = await createTestUser(pool, { isActive: false, email: 'invitee@example.com' });
      try {
        const rawToken = await insertInvite(id);
        const res = await request(app.getHttpServer()).get(`/api/auth/invite/${rawToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ email: 'invitee@example.com', display_name: null });
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('GET /api/auth/invite/:token returns 400 for a malformed token (never reaches the DB)', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/invite/not-a-token');
      expect(res.status).toBe(400);
    });

    it('GET /api/auth/invite/:token returns 404 for a well-formed but unknown token', async () => {
      const res = await request(app.getHttpServer()).get(`/api/auth/invite/${'a'.repeat(64)}`);
      expect(res.status).toBe(404);
    });

    it('POST /api/auth/accept-invite activates the user and returns a working token, no Authorization header needed', async () => {
      const { id } = await createTestUser(pool, { isActive: false });
      try {
        const rawToken = await insertInvite(id);
        const res = await request(app.getHttpServer()).post('/api/auth/accept-invite').send({ token: rawToken, password: 'a-brand-new-password' });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe('string');
        expect(res.body.user).toMatchObject({ id });

        const meRes = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
        expect(meRes.status).toBe(200);
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('POST /api/auth/accept-invite returns 400 for a password shorter than 8 characters (never reaches the DB)', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/accept-invite').send({ token: 'a'.repeat(64), password: 'short' });
      expect(res.status).toBe(400);
    });

    it('POST /api/auth/accept-invite returns 410 for an expired invite', async () => {
      const { id } = await createTestUser(pool, { isActive: false });
      try {
        const rawToken = await insertInvite(id, { expiresInMs: -1000 });
        const res = await request(app.getHttpServer()).post('/api/auth/accept-invite').send({ token: rawToken, password: 'a-brand-new-password' });
        expect(res.status).toBe(410);
      } finally {
        await deleteTestUser(pool, id);
      }
    });

    it('POST /api/auth/accept-invite returns 410 for an already-used invite', async () => {
      const { id } = await createTestUser(pool, { isActive: false });
      try {
        const rawToken = await insertInvite(id, { consumedAt: new Date() });
        const res = await request(app.getHttpServer()).post('/api/auth/accept-invite').send({ token: rawToken, password: 'a-brand-new-password' });
        expect(res.status).toBe(410);
      } finally {
        await deleteTestUser(pool, id);
      }
    });
  });
});
