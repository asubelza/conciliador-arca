import { Pool } from 'pg';
import { cerrarPeriodo } from './periodo-cierre';
import { reabrirPeriodo } from './periodo-reapertura';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T52 — RF-31..RF-34
 * (openspec/specs/dashboard-principal/periodo-reapertura.spec.md), against
 * real Postgres. Same fixture style as periodo-cierre.test.ts: vouchers are
 * inserted straight into vouchers_canonical so each scenario controls
 * estado/periodo_alta_id/periodo_cierre_id precisely, independent of the
 * upsert writer's own (separately-tested) semantics.
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

describe('T52/T53: reabrirPeriodo (RF-31, RF-32, RF-33, RF-34)', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-reapertura.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM periodo_resultados WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
    await pool.query("DELETE FROM audit_trail WHERE tenant_id = $1 AND action IN ('reopen', 'close')", [tenantId]);
    await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
  });

  it('RF-32/RF-33 Scenario: close → reopen returns stamped vouchers to pendiente with NULL stamps and counts both undos', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    // Two matched pairs -> 4 conciliado-stamped vouchers + 2 snapshot rows.
    const sistemaA = await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1 });
    const arcaA = await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1 });
    const sistemaB = await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 2,
      importeTotal: 995,
    });
    const arcaB = await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 2 });

    const closed = await cerrarPeriodo(pool, p1, null);
    if ('code' in closed) throw new Error('expected the initial cierre to succeed');

    const result = await reabrirPeriodo(pool, p1);
    if ('code' in result) throw new Error(`expected success, got failure: ${result.error}`);

    expect(result.counts.vouchers_reabiertos).toBe(4);
    expect(result.counts.resultados_eliminados).toBe(2);

    const { rows } = await pool.query<{ estado: string; periodo_cierre_id: string | null }>(
      'SELECT estado, periodo_cierre_id FROM vouchers_canonical WHERE id = ANY($1::uuid[])',
      [[sistemaA, arcaA, sistemaB, arcaB]],
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.estado === 'pendiente')).toBe(true);
    expect(rows.every((r) => r.periodo_cierre_id === null)).toBe(true);

    const { rows: snapshotRows } = await pool.query(
      'SELECT id FROM periodo_resultados WHERE periodo_id = $1',
      [p1],
    );
    expect(snapshotRows).toEqual([]);
  });

  it('RF-33 Scenario: reopen resets exactly cierre’s column set and returns the reopened período row', async () => {
    await pool.query('UPDATE tenants SET tolerancia_redondeo_ars = 0.99 WHERE id = $1', [tenantId]);
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1, importeTotal: 500 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1, importeTotal: 500 });

    const closed = await cerrarPeriodo(pool, p1, 'contador@estudio.com');
    if ('code' in closed) throw new Error('expected the initial cierre to succeed');
    const closedAtBefore = closed.periodo.cerrado_at;
    expect(closedAtBefore).toBeTruthy();

    const result = await reabrirPeriodo(pool, p1);
    if ('code' in result) throw new Error('expected success');

    expect(result.periodo).toEqual({
      id: p1,
      tenant_id: tenantId,
      mes: '2026-01-01',
      estado: 'abierto',
      tolerancia_ars: null,
      cerrado_at: null,
      cerrado_por: null,
    });

    const { rows } = await pool.query<{ estado: string; tolerancia_ars: string | null; cerrado_at: string | null; cerrado_por: string | null }>(
      'SELECT estado, tolerancia_ars, cerrado_at::text AS cerrado_at, cerrado_por FROM periodos WHERE id = $1',
      [p1],
    );
    expect(rows[0]).toEqual({
      estado: 'abierto',
      tolerancia_ars: null,
      cerrado_at: null,
      cerrado_por: null,
    });
  });

  it('RF-32 Scenario: a manual resolver-sin-pareja mark survives reopen untouched', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-02-01');
    // Manually resolved ARCA voucher — set conciliado WITHOUT a
    // periodo_cierre_id stamp, exactly what POST
    // /api/periodos/:id/pendientes-arca-resolver writes.
    const manualId = await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 50 });
    await pool.query("UPDATE vouchers_canonical SET estado = 'conciliado' WHERE id = $1", [manualId]);

    // A second pair gets closed normally so the período is genuinely cerrado.
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 51, cuitEmisor: '30222222223' });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 51, cuitEmisor: '30222222223' });
    const closed = await cerrarPeriodo(pool, p1, null);
    if ('code' in closed) throw new Error('expected the initial cierre to succeed');

    const result = await reabrirPeriodo(pool, p1);
    if ('code' in result) throw new Error('expected success');
    // Only the stamped pair was undone; the manual mark is not counted.
    expect(result.counts.vouchers_reabiertos).toBe(2);

    const { rows } = await pool.query<{ estado: string; periodo_cierre_id: string | null }>(
      'SELECT estado, periodo_cierre_id FROM vouchers_canonical WHERE id = $1',
      [manualId],
    );
    expect(rows[0].estado).toBe('conciliado');
    expect(rows[0].periodo_cierre_id).toBeNull();
  });

  it('RF-32 Scenario: ARCA rollover stock stays pendiente with its original periodo_alta_id', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-03-01');
    const rolloverIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      rolloverIds.push(
        await insertVoucher(pool, tenantId, {
          fileSource: 'arca',
          periodoAltaId: p1,
          numero: 900 + i,
          cuitEmisor: '30333333333',
        }),
      );
    }

    const closed = await cerrarPeriodo(pool, p1, null);
    if ('code' in closed) throw new Error('expected the initial cierre to succeed');
    expect(closed.counts.pendiente_en_arca).toBe(5);

    const result = await reabrirPeriodo(pool, p1);
    if ('code' in result) throw new Error('expected success');

    const { rows } = await pool.query<{ id: string; estado: string; periodo_alta_id: string; periodo_cierre_id: string | null }>(
      'SELECT id, estado, periodo_alta_id, periodo_cierre_id FROM vouchers_canonical WHERE id = ANY($1::uuid[])',
      [rolloverIds],
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.estado === 'pendiente')).toBe(true);
    expect(rows.every((r) => r.periodo_alta_id === p1)).toBe(true);
    expect(rows.every((r) => r.periodo_cierre_id === null)).toBe(true);
  });

  it('RF-33 Scenario: close → reopen → re-close reproduces an equivalent snapshot', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-04-01');
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1 });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1 });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 2,
      importeTotal: 990,
    });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 2 });

    const firstClose = await cerrarPeriodo(pool, p1, null);
    if ('code' in firstClose) throw new Error('expected the first cierre to succeed');

    const { rows: originalSnapshot } = await pool.query<{ classification: string; composite_key: string; delta: string | null }>(
      'SELECT classification, composite_key, delta::text AS delta FROM periodo_resultados WHERE periodo_id = $1 ORDER BY composite_key',
      [p1],
    );

    const reopened = await reabrirPeriodo(pool, p1);
    if ('code' in reopened) throw new Error('expected the reopen to succeed');

    const secondClose = await cerrarPeriodo(pool, p1, null);
    if ('code' in secondClose) throw new Error('expected the re-close to succeed');

    const { rows: regeneratedSnapshot } = await pool.query<{ classification: string; composite_key: string; delta: string | null }>(
      'SELECT classification, composite_key, delta::text AS delta FROM periodo_resultados WHERE periodo_id = $1 ORDER BY composite_key',
      [p1],
    );
    expect(regeneratedSnapshot).toEqual(originalSnapshot);
  });

  it('RF-34 Scenario: a successful reopen is audited in-transaction with both counts', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-05-01');
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1 });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1 });
    const closed = await cerrarPeriodo(pool, p1, null);
    if ('code' in closed) throw new Error('expected the initial cierre to succeed');

    const result = await reabrirPeriodo(pool, p1);
    if ('code' in result) throw new Error('expected success');

    const { rows } = await pool.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM audit_trail WHERE tenant_id = $1 AND action = 'reopen' AND entity = 'periodo' AND entity_id = $2",
      [tenantId, p1],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toEqual({ vouchers_reabiertos: 2, resultados_eliminados: 1 });
  });

  it('RF-31/RF-34 Scenario: reopening an already-abierto período fails typed 409 ALREADY_ABIERTO and leaves no audit row', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-06-01');

    const result = await reabrirPeriodo(pool, p1);
    expect(result).toEqual({ code: 'ALREADY_ABIERTO', status: 409, error: 'período is already abierto' });

    const { rows } = await pool.query(
      "SELECT id FROM audit_trail WHERE tenant_id = $1 AND action = 'reopen'",
      [tenantId],
    );
    expect(rows).toEqual([]);
  });

  it('RF-31 Scenario: returns a typed 404 NOT_FOUND failure for an unknown período id', async () => {
    const result = await reabrirPeriodo(pool, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ code: 'NOT_FOUND', status: 404, error: 'período not found' });
  });
});
