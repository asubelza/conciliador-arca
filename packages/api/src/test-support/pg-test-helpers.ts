/**
 * pg-test-helpers.ts — shared setup for integration tests that hit the real
 * PostgreSQL test database (see jest.setup-env.ts for the connection
 * string). Not part of the production build surface.
 */
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { hashPassword } from '../auth/password';
import { signToken } from '../auth/jwt';
import type { UserRole } from '../auth/users-types';

/**
 * `createdAt` (2026-08-23, feature 3 de 3): pendientes-historico.ts filters
 * ARCA pendiente vouchers against the tenant's own `created_at` (alta
 * date) — tests of that boundary need to control it directly rather than
 * relying on whatever `now()` happens to be when the test runs.
 */
export async function createTestTenant(pool: Pool, name = 'Test Tenant', createdAt?: string): Promise<string> {
  const id = randomUUID();
  if (createdAt) {
    await pool.query('INSERT INTO tenants (id, name, created_at) VALUES ($1, $2, $3)', [id, name, createdAt]);
  } else {
    await pool.query('INSERT INTO tenants (id, name, created_at) VALUES ($1, $2, now())', [id, name]);
  }
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

/**
 * T38 (Fase 2, autenticacion-roles): a ready-to-use `Authorization` header
 * for controller integration tests. AuthGuard only verifies the JWT's
 * signature/expiry (see auth-guard.ts's module doc) — it never hits the
 * DB — so this mints a token directly with `signToken`, no `users` row
 * required. That's correct for admin/colaborador (they never trigger a
 * user_tenant_access lookup either — see assertTenantAccess). A test that
 * specifically needs a `cliente` WITH real tenant access must still create
 * a real user (createTestUser) and a real user_tenant_access row — a
 * fabricated `cliente` from this helper alone always fails
 * assertTenantAccess, which is what most tests want by default (a plain
 * admin token that always passes).
 */
export function authHeaderFor(role: UserRole = 'admin', overrides: { sub?: string; email?: string } = {}): string {
  const token = signToken({
    sub: overrides.sub ?? randomUUID(),
    role,
    email: overrides.email ?? `test-${role}-${randomUUID()}@example.com`,
  });
  return `Bearer ${token}`;
}

export async function deleteTestUser(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM user_tenant_access WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

export async function deleteTestTenant(pool: Pool, tenantId: string): Promise<void> {
  await pool.query('DELETE FROM vouchers_staging WHERE tenant_id = $1', [tenantId]);
  // RF-04/RF-13: fuzzy_match_confirmations.sistema_voucher_id/arca_voucher_id
  // REFERENCE vouchers_canonical(id) with no ON DELETE CASCADE
  // (020_init_fuzzy_match_confirmations.sql) — must go before
  // vouchers_canonical, or any test that confirmed/discarded a coincidencia
  // for this tenant leaves this cleanup failing on a FK violation.
  await pool.query('DELETE FROM fuzzy_match_confirmations WHERE tenant_id = $1', [tenantId]);
  // RF-09: feedback_loop.tenant_id has no FK constraint (see
  // 010_init_feedback_loop.sql's doc comment), so this isn't required for
  // FK correctness — cleaned up anyway for test isolation.
  await pool.query('DELETE FROM feedback_loop WHERE tenant_id = $1', [tenantId]);
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
