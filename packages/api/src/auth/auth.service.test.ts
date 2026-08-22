import { Pool } from 'pg';
import { login } from './auth.service';
import { verifyToken } from './jwt';
import { createTestUser, deleteTestUser } from '../test-support/pg-test-helpers';

describe('T34/T35: login (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('a correct email/password issues a valid JWT and the right user shape', async () => {
    const { id, email, password } = await createTestUser(pool, { role: 'admin' });
    try {
      const result = await login(pool, email, password);
      if ('code' in result) throw new Error('expected success');
      expect(result.user).toEqual({ id, email, role: 'admin', display_name: null });

      const payload = verifyToken(result.token);
      expect(payload).toEqual({ sub: id, role: 'admin', email });
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('login is case-insensitive on email', async () => {
    // users.email is always stored lowercase (CHECK constraint, migration
    // 018) — createTestUser normalizes it on insert, same as any real
    // account-creation path must. What this test actually proves is that
    // login() ALSO normalizes its input, so logging in with the original
    // mixed-case string (as a person would type it) still matches the
    // normalized row.
    const originalMixedCase = `Mixed-Case-${Date.now()}@Example.com`;
    const { id, password } = await createTestUser(pool, { email: originalMixedCase });
    try {
      const result = await login(pool, originalMixedCase, password);
      expect('code' in result).toBe(false);
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('wrong password returns a generic 401, not a hint', async () => {
    const { id, email } = await createTestUser(pool, { password: 'the-real-one' });
    try {
      const result = await login(pool, email, 'wrong-password');
      expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, error: 'email o contraseña inválidos' });
    } finally {
      await deleteTestUser(pool, id);
    }
  });

  it('unknown email returns the SAME generic 401 as a wrong password (never reveals which email exists)', async () => {
    const result = await login(pool, 'no-such-user@example.com', 'whatever');
    expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, error: 'email o contraseña inválidos' });
  });

  it('a deactivated (is_active=false) user cannot log in even with the correct password', async () => {
    const { id, email, password } = await createTestUser(pool, { isActive: false });
    try {
      const result = await login(pool, email, password);
      expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, error: 'email o contraseña inválidos' });
    } finally {
      await deleteTestUser(pool, id);
    }
  });
});
