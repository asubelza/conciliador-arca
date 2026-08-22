/**
 * pg-test-helpers.ts — shared setup for integration tests that hit the real
 * PostgreSQL test database (see jest.setup-env.ts for the connection
 * string). Not part of the production build surface.
 */
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

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

export async function deleteTestTenant(pool: Pool, tenantId: string): Promise<void> {
  await pool.query('DELETE FROM vouchers_staging WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM reconciliation_results WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM audit_trail WHERE tenant_id = $1', [tenantId]);
  // periodos.tenant_id REFERENCES tenants(id) with no ON DELETE CASCADE
  // (013_init_periodos.sql) — must go before the tenants row itself.
  await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
}
