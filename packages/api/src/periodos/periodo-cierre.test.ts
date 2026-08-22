import { Pool } from 'pg';
import { cerrarPeriodo } from './periodo-cierre';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T27/T28 — RF-20/RF-21
 * (openspec/specs/conciliacion-periodica/cierre-de-mes.spec.md), against
 * real Postgres. Fixtures are inserted straight into vouchers_canonical
 * (same style as periodo-matching-engine.test.ts) so each scenario controls
 * estado/periodo_alta_id precisely, independent of the upsert writer's own
 * (separately-tested) semantics.
 */
async function insertVoucher(
  pool: Pool,
  tenantId: string,
  overrides: {
    cuitEmisor?: string;
    tipoCbte?: number;
    puntoVenta?: number;
    numero?: number;
    importeTotal?: number;
    fileSource: 'arca' | 'contabilidad';
    estado?: 'pendiente' | 'conciliado';
    periodoAltaId: string;
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vouchers_canonical (
       tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
       file_source, estado, periodo_alta_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      tenantId,
      overrides.cuitEmisor ?? '30111111112',
      overrides.tipoCbte ?? 1,
      overrides.puntoVenta ?? 1,
      overrides.numero ?? 100,
      overrides.importeTotal ?? 1000,
      overrides.fileSource,
      overrides.estado ?? 'pendiente',
      overrides.periodoAltaId,
    ],
  );
  return rows[0].id;
}

describe('T27/T28: cerrarPeriodo (RF-20, RF-21)', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-cierre.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM periodo_resultados WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
  });

  it('RF-20 Scenario: closing a período conciliates its matched vouchers (clean + con_divergencia)', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const sistemaOkId = await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 1,
      importeTotal: 1000,
    });
    const arcaOkId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 1,
      importeTotal: 1000,
    });
    const sistemaDivId = await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 2,
      importeTotal: 995,
    });
    const arcaDivId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 2,
      importeTotal: 1000,
    });

    const result = await cerrarPeriodo(pool, p1, 'contador@estudio.com');
    if ('code' in result) throw new Error(`expected success, got failure: ${result.error}`);
    expect(result.periodo.estado).toBe('cerrado');
    expect(result.counts.conciliado_ok).toBe(1);
    expect(result.counts.con_divergencia).toBe(1);

    const { rows } = await pool.query<{ id: string; estado: string; periodo_cierre_id: string }>(
      'SELECT id, estado, periodo_cierre_id FROM vouchers_canonical WHERE id = ANY($1::uuid[])',
      [[sistemaOkId, arcaOkId, sistemaDivId, arcaDivId]],
    );
    expect(rows.every((r) => r.estado === 'conciliado')).toBe(true);
    expect(rows.every((r) => r.periodo_cierre_id === p1)).toBe(true);
  });

  it('RF-20 Scenario: closing leaves unmatched ARCA vouchers pendiente for the future', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const pendienteId = await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 99 });

    const result = await cerrarPeriodo(pool, p1, null);
    if ('code' in result) throw new Error('expected success');
    expect(result.counts.pendiente_en_arca).toBe(1);

    const { rows } = await pool.query<{ estado: string; periodo_alta_id: string; periodo_cierre_id: string | null }>(
      'SELECT estado, periodo_alta_id, periodo_cierre_id FROM vouchers_canonical WHERE id = $1',
      [pendienteId],
    );
    expect(rows[0].estado).toBe('pendiente');
    expect(rows[0].periodo_alta_id).toBe(p1);
    expect(rows[0].periodo_cierre_id).toBeNull();

    // A later período's match still finds it in the historical pool (RF-16 step 3).
    const p2 = await createTestPeriodo(pool, tenantId, '2026-02-01');
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p2, numero: 99 });
    const secondClose = await cerrarPeriodo(pool, p2, null);
    if ('code' in secondClose) throw new Error('expected success');
    expect(secondClose.counts.conciliado_ok).toBe(1);
  });

  it('RF-20 Scenario: closing an already-closed período is rejected with a typed 409 failure', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const first = await cerrarPeriodo(pool, p1, null);
    expect('code' in first).toBe(false);

    const second = await cerrarPeriodo(pool, p1, null);
    expect(second).toEqual({ code: 'ALREADY_CERRADO', status: 409, error: 'período is already cerrado' });
  });

  it('returns a typed 404 failure for an unknown período id', async () => {
    const result = await cerrarPeriodo(pool, '00000000-0000-0000-0000-000000000000', null);
    expect(result).toEqual({ code: 'NOT_FOUND', status: 404, error: 'período not found' });
  });

  it('RF-21 Scenario: changing tenant tolerance after closing does not rewrite the snapshotted value', async () => {
    await pool.query('UPDATE tenants SET tolerancia_redondeo_ars = 0.99 WHERE id = $1', [tenantId]);
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');

    const result = await cerrarPeriodo(pool, p1, null);
    if ('code' in result) throw new Error('expected success');
    expect(Number(result.periodo.tolerancia_ars)).toBeCloseTo(0.99);

    await pool.query('UPDATE tenants SET tolerancia_redondeo_ars = 2.0 WHERE id = $1', [tenantId]);
    const { rows } = await pool.query<{ tolerancia_ars: string }>('SELECT tolerancia_ars FROM periodos WHERE id = $1', [
      p1,
    ]);
    expect(Number(rows[0].tolerancia_ars)).toBeCloseTo(0.99);
  });

  it('RF-20(4): freezes an immutable periodo_resultados snapshot with one row per match result', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1, importeTotal: 500 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1, importeTotal: 500 });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 2, importeTotal: 700 });

    const result = await cerrarPeriodo(pool, p1, null);
    if ('code' in result) throw new Error('expected success');

    const { rows } = await pool.query<{ classification: string }>(
      'SELECT classification FROM periodo_resultados WHERE periodo_id = $1 ORDER BY classification',
      [p1],
    );
    expect(rows).toHaveLength(2); // conciliado_ok + pendiente_en_arca
    expect(rows.map((r) => r.classification).sort()).toEqual(['conciliado_ok', 'pendiente_en_arca']);
  });

  it('periodo_resultados is append-only for app_role, same guarantee as audit_trail', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const result = await cerrarPeriodo(pool, p1, null);
    if ('code' in result) throw new Error('expected success');

    // Same pattern as audit-logger.test.ts's runAsAppRole: app_role is
    // subject to the tenant_isolation RLS policy too, so app.tenant_id must
    // be set for its statement to resolve any rows at all, independent of
    // the REVOKE this test targets.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await client.query('SET ROLE app_role');
      await expect(
        client.query("UPDATE periodo_resultados SET classification = 'con_divergencia' WHERE periodo_id = $1", [p1]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
