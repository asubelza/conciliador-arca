import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { assertPeriodoOpenForUpload } from './periodo-upload-guard';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T19 (RF-13) — real-Postgres coverage for the DB-backed part of the
 * periodo_id upload guard: exists+belongs-to-tenant+abierto. The pure
 * format check (UUID shape) is covered by upload-validation.test.ts.
 */
describe('T19: assertPeriodoOpenForUpload', () => {
  let pool: Pool;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-upload-guard.test');
    otherTenantId = await createTestTenant(pool, 'periodo-upload-guard.test (other)');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await deleteTestTenant(pool, otherTenantId);
    await pool.end();
  });

  it('returns null for an abierto período belonging to the tenant', async () => {
    const periodoId = await createTestPeriodo(pool, tenantId, '2026-05-01');
    expect(await assertPeriodoOpenForUpload(pool, tenantId, periodoId)).toBeNull();
  });

  it('rejects an unknown periodo_id', async () => {
    const result = await assertPeriodoOpenForUpload(pool, tenantId, randomUUID());
    expect(result).toEqual({
      status: 400,
      error: 'periodo_id does not reference an existing período for this tenant',
    });
  });

  it("rejects a periodo_id that exists but belongs to a different tenant (doesn't leak existence)", async () => {
    const otherPeriodoId = await createTestPeriodo(pool, otherTenantId, '2026-06-01');
    const result = await assertPeriodoOpenForUpload(pool, tenantId, otherPeriodoId);
    expect(result).toEqual({
      status: 400,
      error: 'periodo_id does not reference an existing período for this tenant',
    });
  });

  it('rejects a cerrado período', async () => {
    const periodoId = await createTestPeriodo(pool, tenantId, '2026-07-01');
    await pool.query("UPDATE periodos SET estado = 'cerrado' WHERE id = $1", [periodoId]);

    const result = await assertPeriodoOpenForUpload(pool, tenantId, periodoId);
    expect(result).toEqual({
      status: 400,
      error: 'período is closed — uploads are only accepted while abierto',
    });
  });
});
