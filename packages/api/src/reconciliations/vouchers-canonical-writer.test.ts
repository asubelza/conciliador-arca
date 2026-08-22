import { Pool, PoolClient } from 'pg';
import { upsertVouchersCanonical } from './vouchers-canonical-writer';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';
import type { CanonicalVoucher } from 'shared-types';

/**
 * T22 — RF-15 (openspec/specs/conciliacion-periodica/stock-historico-comprobantes.spec.md)
 *
 * Real-Postgres coverage: the composite-key upsert, the immutable-once-
 * conciliado guarantee, and the periodo_alta_id asymmetry documented in
 * this module's own header comment (ARCA immutable, contabilidad refreshed).
 */
function voucher(overrides: Partial<CanonicalVoucher> = {}): CanonicalVoucher {
  return {
    cuit_emisor: '30111111112',
    tipo_cbte: 1,
    punto_venta: 1,
    numero: 100,
    fecha_emision: '2026-04-01',
    importe_total_ars: 1000,
    iva: 0,
    moneda: 'ARS',
    file_source: 'arca',
    source_row: {},
    ...overrides,
  };
}

describe('T22: upsertVouchersCanonical', () => {
  let pool: Pool;
  let client: PoolClient;
  let tenantId: string;
  let periodoP1: string;
  let periodoP2: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'vouchers-canonical-writer.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    periodoP1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    periodoP2 = await createTestPeriodo(pool, tenantId, '2026-02-01');
  });

  afterEach(async () => {
    await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
    client.release();
  });

  it('inserts a first-seen voucher as pendiente with periodo_alta_id set', async () => {
    const result = await upsertVouchersCanonical(client, tenantId, periodoP1, [voucher()]);
    expect(result).toEqual({ upserted: 1, skippedConciliado: 0 });

    const { rows } = await pool.query(
      "SELECT estado, periodo_alta_id, importe_total::float AS importe_total FROM vouchers_canonical WHERE tenant_id = $1",
      [tenantId],
    );
    expect(rows).toEqual([{ estado: 'pendiente', periodo_alta_id: periodoP1, importe_total: 1000 }]);
  });

  it('re-upserting the same composite key updates importe_total, not a duplicate row (RF-15)', async () => {
    await upsertVouchersCanonical(client, tenantId, periodoP1, [voucher({ importe_total_ars: 1000 })]);
    const result = await upsertVouchersCanonical(client, tenantId, periodoP1, [
      voucher({ importe_total_ars: 1050 }),
    ]);
    expect(result).toEqual({ upserted: 1, skippedConciliado: 0 });

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n, max(importe_total::float) AS importe_total FROM vouchers_canonical WHERE tenant_id = $1",
      [tenantId],
    );
    expect(rows[0]).toEqual({ n: 1, importe_total: 1050 });
  });

  it('a conciliado row is never overwritten by a later upsert (RF-15 third scenario)', async () => {
    await upsertVouchersCanonical(client, tenantId, periodoP1, [voucher({ importe_total_ars: 1000 })]);
    await pool.query(
      "UPDATE vouchers_canonical SET estado = 'conciliado', periodo_cierre_id = $2 WHERE tenant_id = $1",
      [tenantId, periodoP1],
    );

    const result = await upsertVouchersCanonical(client, tenantId, periodoP2, [
      voucher({ importe_total_ars: 9999 }),
    ]);
    expect(result).toEqual({ upserted: 0, skippedConciliado: 1 });

    const { rows } = await pool.query(
      "SELECT estado, periodo_alta_id, importe_total::float AS importe_total FROM vouchers_canonical WHERE tenant_id = $1",
      [tenantId],
    );
    expect(rows).toEqual([{ estado: 'conciliado', periodo_alta_id: periodoP1, importe_total: 1000 }]);
  });

  it("ARCA's periodo_alta_id stays fixed at first insert across later upserts", async () => {
    await upsertVouchersCanonical(client, tenantId, periodoP1, [voucher({ file_source: 'arca' })]);
    await upsertVouchersCanonical(client, tenantId, periodoP2, [voucher({ file_source: 'arca' })]);

    const { rows } = await pool.query('SELECT periodo_alta_id FROM vouchers_canonical WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(rows).toEqual([{ periodo_alta_id: periodoP1 }]);
  });

  it("contabilidad's periodo_alta_id refreshes to the current período on re-upsert", async () => {
    await upsertVouchersCanonical(client, tenantId, periodoP1, [voucher({ file_source: 'contabilidad' })]);
    await upsertVouchersCanonical(client, tenantId, periodoP2, [voucher({ file_source: 'contabilidad' })]);

    const { rows } = await pool.query('SELECT periodo_alta_id FROM vouchers_canonical WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(rows).toEqual([{ periodo_alta_id: periodoP2 }]);
  });

  it('arca and contabilidad sides with the same CUIT/tipo/PV/número are two distinct rows (composite key includes file_source)', async () => {
    await upsertVouchersCanonical(client, tenantId, periodoP1, [
      voucher({ file_source: 'arca' }),
      voucher({ file_source: 'contabilidad' }),
    ]);

    const { rows } = await pool.query(
      'SELECT file_source FROM vouchers_canonical WHERE tenant_id = $1 ORDER BY file_source',
      [tenantId],
    );
    expect(rows).toEqual([{ file_source: 'arca' }, { file_source: 'contabilidad' }]);
  });

  it('a missing fecha_emision (empty string from the normalizer) is stored as NULL, not a date-parse error', async () => {
    const result = await upsertVouchersCanonical(client, tenantId, periodoP1, [
      voucher({ fecha_emision: '' }),
    ]);
    expect(result).toEqual({ upserted: 1, skippedConciliado: 0 });

    const { rows } = await pool.query('SELECT fecha FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
    expect(rows).toEqual([{ fecha: null }]);
  });

  it('tenant isolation: two tenants can each have a voucher with the same composite key', async () => {
    const otherTenantId = await createTestTenant(pool, 'vouchers-canonical-writer.test (other)');
    const otherPeriodo = await createTestPeriodo(pool, otherTenantId, '2026-01-01');
    try {
      await upsertVouchersCanonical(client, tenantId, periodoP1, [voucher()]);
      await upsertVouchersCanonical(client, otherTenantId, otherPeriodo, [voucher()]);

      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM vouchers_canonical WHERE tenant_id IN ($1, $2)',
        [tenantId, otherTenantId],
      );
      expect(rows[0].n).toBe(2);
    } finally {
      await deleteTestTenant(pool, otherTenantId);
    }
  });
});
