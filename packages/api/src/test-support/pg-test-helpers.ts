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
 * Multi-estudio pivot (028_init_estudios.sql): `estudios` is the new top
 * level above `tenants` — no FK of its own, nothing sits above it.
 */
export async function createTestEstudio(pool: Pool, name = 'Test Estudio'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('INSERT INTO estudios (name) VALUES ($1) RETURNING id', [name]);
  return rows[0].id;
}

/**
 * Multi-estudio pivot (029/031): `tenants.estudio_id` is NOT NULL, so every
 * tenant needs *some* estudio to point to. The overwhelming majority of the
 * ~700 existing call sites predate the pivot and don't care which estudio
 * they land in — lazily creating ONE shared estudio per test file and
 * reusing it for every tenant/user that doesn't pass its own `estudioId`
 * keeps those call sites unchanged. This module-level variable is safe as a
 * per-FILE cache, not a global singleton: Jest gives each test file its own
 * module registry (confirmed — jest.api.json sets no custom
 * testEnvironment/worker options that would change this default), so it
 * resets to `null` for every file and is never shared across files running
 * in parallel.
 *
 * Caches the IN-FLIGHT promise, not just its eventual value, so concurrent
 * callers within the same tick (e.g. two createTestTenant calls awaited in
 * Promise.all) share one INSERT instead of racing two. A REJECTED promise
 * is cleared back to `null` in the `.catch` below — otherwise one transient
 * DB hiccup on the first call would poison every subsequent test in the
 * file with the same rejection forever (a rejected promise is still
 * truthy, so the `if (!sharedTestEstudioId)` guard alone would never retry).
 *
 * NOT cleaned up by this module: Jest only allows hooks (`afterAll`) to be
 * registered synchronously during test collection, never lazily from
 * inside an already-running `beforeAll`/test (confirmed — doing so throws
 * "Cannot add a hook after tests have started running"), and this function
 * is only ever reachable from inside a test file's own `beforeAll`. Each
 * run therefore leaves one orphaned "Shared Test Estudio" row per test
 * file against a persistent local test DB — harmless test-DB bloat, not a
 * correctness issue, and out of scope to fix here without threading an
 * explicit cleanup call through every one of this repo's test files.
 */
let sharedTestEstudioId: Promise<string> | null = null;

function defaultTestEstudioId(pool: Pool): Promise<string> {
  if (!sharedTestEstudioId) {
    sharedTestEstudioId = createTestEstudio(pool, 'Shared Test Estudio').catch((err: unknown) => {
      sharedTestEstudioId = null;
      throw err;
    });
  }
  return sharedTestEstudioId;
}

/**
 * `createdAt` (2026-08-23, feature 3 de 3): pendientes-historico.ts filters
 * ARCA pendiente vouchers against the tenant's own `created_at` (alta
 * date) — tests of that boundary need to control it directly rather than
 * relying on whatever `now()` happens to be when the test runs.
 *
 * `estudioId` (multi-estudio pivot): defaults to the shared per-file test
 * estudio (see `defaultTestEstudioId` above) — pass one explicitly only
 * when a test asserts estudio-level isolation.
 */
export async function createTestTenant(
  pool: Pool,
  name = 'Test Tenant',
  createdAt?: string,
  estudioId?: string,
): Promise<string> {
  const id = randomUUID();
  const resolvedEstudioId = estudioId ?? (await defaultTestEstudioId(pool));
  if (createdAt) {
    await pool.query('INSERT INTO tenants (id, name, created_at, estudio_id) VALUES ($1, $2, $3, $4)', [
      id,
      name,
      createdAt,
      resolvedEstudioId,
    ]);
  } else {
    await pool.query('INSERT INTO tenants (id, name, created_at, estudio_id) VALUES ($1, $2, now(), $3)', [
      id,
      name,
      resolvedEstudioId,
    ]);
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
 *
 * `estudioId` (multi-estudio pivot): defaults to the SAME shared per-file
 * estudio `createTestTenant` defaults to, so an admin/colaborador created
 * without specifying anything lands in the same estudio as a tenant
 * created without specifying anything — this is what makes
 * `assertTenantAccess`'s future estudio-scoped check (PR3) pass by default
 * for existing tests that don't care about estudio isolation. `null` is a
 * real, distinct value (platform-staff user, see
 * 030_alter_users_add_estudio_id.sql) — checked explicitly below so an
 * explicit `estudioId: null` is never coerced back to the default by `??`.
 */
export async function createTestUser(
  pool: Pool,
  overrides: { email?: string; password?: string; role?: UserRole; isActive?: boolean; estudioId?: string | null } = {},
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
  const estudioId = overrides.estudioId === null ? null : overrides.estudioId ?? (await defaultTestEstudioId(pool));
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (email, password_hash, role, is_active, estudio_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [email, passwordHash, role, overrides.isActive ?? true, estudioId],
  );
  return { id: rows[0].id, email, password };
}

/**
 * T38 (Fase 2, autenticacion-roles): a ready-to-use `Authorization` header
 * for controller integration tests. AuthGuard only verifies the JWT's
 * signature/expiry (see auth-guard.ts's module doc) — it never hits the
 * DB — so this mints a token directly with `signToken`, no `users` row
 * required. A test that specifically needs a `cliente` WITH real tenant
 * access must still create a real user (createTestUser) and a real
 * user_tenant_access row.
 *
 * `estudioId` (multi-estudio pivot, PR3 of 8): now threaded into the signed
 * token's `estudio_id` claim, same null-vs-undefined handling as
 * `createTestUser`'s own `estudioId` override (explicit `null` stays
 * `null` — a platform-staff token — and is never coerced by `??`).
 *
 * UNLIKE `createTestTenant`/`createTestUser`, the "default when omitted"
 * case here can NOT reuse `defaultTestEstudioId` (the real, lazily-created,
 * per-file shared `estudios` row) — plenty of call sites across this
 * repo's *.controller.test.ts files assign `authHeaderFor(...)` to a
 * `describe`-scope `const` evaluated at test-collection time, before
 * `pool` even exists (it's only assigned inside `beforeAll`), so this
 * function must stay synchronous and can't do a DB round trip. The default
 * below is therefore just a fresh, syntactically valid, non-null UUID —
 * NOT a real `estudios` row and NOT guaranteed to match any tenant's
 * `estudio_id`. A test whose admin/colaborador token needs to actually
 * pass the new estudio-scoped `assertTenantAccess` against a real tenant
 * MUST pass an explicit `estudioId` here that matches the one the tenant
 * fixture was created with — relying on this default for that case will
 * now get a 403 instead of the old unconditional bypass.
 */
export function authHeaderFor(
  role: UserRole = 'admin',
  overrides: { sub?: string; email?: string; estudioId?: string | null } = {},
): string {
  const token = signToken({
    sub: overrides.sub ?? randomUUID(),
    role,
    email: overrides.email ?? `test-${role}-${randomUUID()}@example.com`,
    estudio_id: overrides.estudioId === null ? null : overrides.estudioId ?? randomUUID(),
  });
  return `Bearer ${token}`;
}

export async function deleteTestUser(pool: Pool, userId: string): Promise<void> {
  await pool.query('DELETE FROM user_tenant_access WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

/**
 * For tests that create their OWN throwaway estudio to assert isolation —
 * not for the shared default estudio created lazily by createTestTenant/
 * createTestUser (never deleted; it lives for the test file's duration and
 * is dropped along with the rest of the test DB).
 *
 * `tenants.estudio_id` REFERENCES estudios(id) with no ON DELETE CASCADE
 * (029_alter_tenants_add_estudio_id.sql) and is NOT NULL, so callers must
 * delete every tenant under this estudio first (deleteTestTenant) — same
 * FK-ordering discipline as deleteTestTenant's own comments below.
 */
export async function deleteTestEstudio(pool: Pool, estudioId: string): Promise<void> {
  await pool.query('DELETE FROM estudios WHERE id = $1', [estudioId]);
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
