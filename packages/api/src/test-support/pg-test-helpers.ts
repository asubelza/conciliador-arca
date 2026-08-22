/**
 * pg-test-helpers.ts — shared setup for integration tests that hit the real
 * PostgreSQL test database (see jest.setup-env.ts for the connection
 * string). Not part of the production build surface.
 */
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { hashPassword } from '../auth/password';
import type { UserRole } from '../auth/users-types';

export async function createTestTenant(pool: Pool, name = 'Test Tenant'): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

/**
 * conciliacion-periodica T16: creates an `abierto` período for a test
 * tenant. `mes` defaults to a fixed, distinctive month so parallel test
 * files creating their own tenant+período pairs never collide on
 * `UNIQUE (tenant_id, mes)` (each gets its own tenant_id anyway, but a
 * literal default avoids ever having to think about it).
 */
export async function createTestPeriodo(pool: Pool, tenantId: string, mes = '2026-01-01'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO periodos (tenant_id, mes) VALUES ($1, $2::date) RETURNING id",
    [tenantId, mes],
  );
  return rows[0].id;
}

/**
 * T33/T34 (autenticacion-roles): creates a real, correctly-hashed test
 * user (real bcrypt, not a stub) so login tests exercise the actual
 * password-verification path, not a shortcut.
 */
export async function createTestUser(
  pool: Pool,
  overrides: { email?: string; password?: string; role?: UserRole; isActive?: boolean } = {},
): Promise<{ id: string; email: string; password: string }> {
  // users.email has a CHECK (email = lower(email)) constraint (migration
  // 018) — normalize here the same way any real account-creation path
  // must, so a caller passing a mixed-case override (e.g. to test
  // case-insensitive login) doesn't hit the constraint or silently create
  // a row login() can never match.
  const email = (overrides.email ?? `test-${randomUUID()}@example.com`).trim().toLowerCase();
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const role = overrides.role ?? 'admin';
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, passwordHash, role, overrides.isActive ?? true],
  );
  return { id: rows[0].id, email, password };
}

export async function deleteTestUser(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM user_tenant_access WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

export async function deleteTestTenant(pool: Pool, tenantId: string): Promise<void> {
  await pool.query('DELETE FROM vouchers_staging WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM reconciliation_results WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM audit_trail WHERE tenant_id = $1', [tenantId]);
  // periodo_resultados.periodo_id REFERENCES periodos(id) with no ON DELETE
  // CASCADE (016_init_periodo_resultados.sql) — must go before periodos.
  await pool.query('DELETE FROM periodo_resultados WHERE tenant_id = $1', [tenantId]);
  // periodos.tenant_id REFERENCES tenants(id) with no ON DELETE CASCADE
  // (013_init_periodos.sql) — must go before the tenants row itself.
  await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
}
