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

export async function deleteTestTenant(pool: Pool, tenantId: string): Promise<void> {
  await pool.query('DELETE FROM vouchers_staging WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM reconciliation_results WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM audit_trail WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
}
