import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createTestUser, deleteTestUser } from '../test-support/pg-test-helpers';
import { signToken } from './jwt';

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
});
