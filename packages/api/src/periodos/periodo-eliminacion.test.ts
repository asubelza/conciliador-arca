import { Pool } from 'pg';
import { eliminarPeriodo } from './periodo-eliminacion';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T54 — RF-36..RF-38
 * (openspec/specs/dashboard-principal/periodo-eliminacion.spec.md), against
 * real Postgres. Same fixture style as periodo-cierre.test.ts /
 * periodo-reapertura.test.ts: fixtures are inserted straight into
 * vouchers_canonical / periodo_resultados so each scenario controls the
 * guard's two counts (c1 = alta/cierre-stamped vouchers, c2 = frozen
 * snapshot rows) precisely.
 */
async function insertVoucher(
  pool: Pool,
  tenantId: string,
  overrides: {
    cuitEmisor?: string;
    tipoCbte?: number;
    puntoVenta?: number;
    numero?: number;
    fileSource: 'arca' | 'contabilidad';
    estado?: 'pendiente' | 'conciliado';
    periodoAltaId: string;
    periodoCierreId?: string;
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vouchers_canonical (
       tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
       file_source, estado, periodo_alta_id, periodo_cierre_id, fecha
     ) VALUES ($1, $2, $3, $4, $5, 1000, $6, $7, $8, $9, '2026-01-15')
     RETURNING id`,
    [
      tenantId,
      overrides.cuitEmisor ?? '30111111112',
      overrides.tipoCbte ?? 1,
      overrides.puntoVenta ?? 1,
      overrides.numero ?? Math.floor(Math.random() * 1_000_000),
      overrides.fileSource,
      overrides.estado ?? 'pendiente',
      overrides.periodoAltaId,
      overrides.periodoCierreId ?? null,
    ],
  );
  return rows[0].id;
}

describe('T54/T55: eliminarPeriodo (RF-35, RF-36, RF-37, RF-38)', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-eliminacion.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query("DELETE FROM audit_trail WHERE tenant_id = $1 AND action IN ('delete', 'close')", [tenantId]);
    await deleteTestTenant(pool, tenantId);
    tenantId = await createTestTenant(pool, 'periodo-eliminacion.test');
  });

  it('RF-35 Scenario: deleting a truly empty período returns {deleted:true} and physically removes the row', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');

    const result = await eliminarPeriodo(pool, p1);
    expect(result).toEqual({ deleted: true, periodo_id: p1 });

    const { rows } = await pool.query('SELECT id FROM periodos WHERE id = $1', [p1]);
    expect(rows).toEqual([]);
  });

  it('RF-38 Scenario: the freed (tenant_id, mes) slot becomes recreatable after a successful delete', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-07-01');

    const result = await eliminarPeriodo(pool, p1);
    expect(result).toEqual({ deleted: true, periodo_id: p1 });

    // UNIQUE (tenant_id, mes) must accept a new período for the same month.
    const recreated = await createTestPeriodo(pool, tenantId, '2026-07-01');
    expect(recreated).toBeTruthy();
    expect(recreated).not.toBe(p1);
  });

  it('design delete-sequence: a successful delete is audited in-transaction; a blocked one leaves no audit row', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-02-01');

    const result = await eliminarPeriodo(pool, p1);
    expect(result).toEqual({ deleted: true, periodo_id: p1 });

    const { rows } = await pool.query<{ entity: string | null; entity_id: string | null }>(
      "SELECT entity, entity_id FROM audit_trail WHERE tenant_id = $1 AND action = 'delete'",
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'periodo', entity_id: p1 });

    // Now a BLOCKED attempt must not add a second 'delete' row.
    const p2 = await createTestPeriodo(pool, tenantId, '2026-02-01'); // same mes is free again after p1's delete
    const blocked = await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p2, numero: 777 });
    const secondAttempt = await eliminarPeriodo(pool, p2);
    if (!('code' in secondAttempt)) throw new Error('expected the guarded delete to be blocked');
    expect(secondAttempt.status).toBe(409);

    const { rows: auditRowsAfterBlock } = await pool.query(
      "SELECT id FROM audit_trail WHERE tenant_id = $1 AND action = 'delete'",
      [tenantId],
    );
    expect(auditRowsAfterBlock).toHaveLength(1); // still only p1's committed delete

    // The blocker voucher is untouched by the rolled-back attempt.
    const { rows: voucherRows } = await pool.query('SELECT id FROM vouchers_canonical WHERE id = $1', [blocked]);
    expect(voucherRows).toHaveLength(1);
  });

  it('RF-36 Scenario: período with alta-stamped AND cierre-stamped vouchers is blocked with both counts named', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-03-01');
    // Two vouchers stamped periodo_alta_id=P1 (uploaded while abierto).
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 2 });

    // A separate closed período P2 whose matched voucher carries
    // periodo_cierre_id=P2 — proves c1 counts cierre stamps too. Its
    // snapshot rows also count toward c2.
    const p2 = await createTestPeriodo(pool, tenantId, '2026-04-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      estado: 'conciliado',
      periodoAltaId: p2,
      periodoCierreId: p2,
      numero: 3,
    });
    await pool.query(
      `INSERT INTO periodo_resultados (tenant_id, periodo_id, classification, composite_key)
       VALUES ($1, $2, 'conciliado_ok', 'k1'), ($1, $2, 'conciliado_ok', 'k2')`,
      [tenantId, p2],
    );

    const blocked = await eliminarPeriodo(pool, p2);
    if (!('code' in blocked)) throw new Error('expected the guarded delete to be blocked');
    expect(blocked.code).toBe('BLOCKED');
    expect(blocked.status).toBe(409);
    expect(blocked.error).toBe(
      'cannot delete período: 1 comprobante(s) and 2 frozen resultado row(s) reference it — only an empty período can be deleted',
    );

    // Nothing was deleted — the whole tx rolled back.
    const { rows: periodoRows } = await pool.query('SELECT id FROM periodos WHERE id = $1', [p2]);
    expect(periodoRows).toHaveLength(1);
  });

  it('RF-36 Scenario: cerrado with zero voucher matches is still blocked via its frozen snapshot rows (c2 > 0)', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-05-01');
    // Closed-with-zero-matches analog: NO vouchers reference P1 at all
    // (c1 = 0), but its matching run left frozen snapshot rows (c2 = 2) —
    // fixture-inserted straight into periodo_resultados, same pattern as
    // app-role-grants.test.ts.
    await pool.query(
      `INSERT INTO periodo_resultados (tenant_id, periodo_id, classification, composite_key)
       VALUES ($1, $2, 'pendiente_en_arca', 'k1'), ($1, $2, 'no_existe_en_arca', 'k2')`,
      [tenantId, p1],
    );

    const blocked = await eliminarPeriodo(pool, p1);
    if (!('code' in blocked)) throw new Error('expected the guarded delete to be blocked');
    expect(blocked.status).toBe(409);
    expect(blocked.error).toBe(
      'cannot delete período: 0 comprobante(s) and 2 frozen resultado row(s) reference it — only an empty período can be deleted',
    );

    const { rows } = await pool.query('SELECT id FROM periodos WHERE id = $1', [p1]);
    expect(rows).toHaveLength(1);
  });

  it('RF-36 Scenario: returns a typed 404 NOT_FOUND failure for an unknown período id', async () => {
    const result = await eliminarPeriodo(pool, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ code: 'NOT_FOUND', status: 404, error: 'período not found' });
  });

  it('RF-37 Scenario: upload wins the race — delete blocks on the row lock, then sees the committed voucher and returns 409 with data intact', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-06-01');

    // Simulate the BullMQ worker's single-tx upload: INSERT takes a FOR KEY
    // SHARE lock on the referenced periodos row; commit happens AFTER the
    // delete has already started waiting on that row.
    const worker = pool.connect();
    const clientA = await worker;
    try {
      await clientA.query('BEGIN');
      await clientA.query(
        `INSERT INTO vouchers_canonical (
           tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
           file_source, estado, periodo_alta_id
         ) VALUES ($1, '30111111112', 1, 1, 424242, 1000, 'arca', 'pendiente', $2)`,
        [tenantId, p1],
      );

      // Start the delete while the worker tx is still open: it MUST block
      // until the worker commits, then observe c1 > 0.
      const deletePromise = eliminarPeriodo(pool, p1);
      let settled = false;
      const probe = deletePromise.then(
        () => {
          settled = true;
        },
        () => undefined,
      );
      // Give the delete time to reach its SELECT ... FOR UPDATE and block.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false); // proof it serialized behind the uncommitted upload

      await clientA.query('COMMIT');

      const result = await deletePromise;
      await probe;
      if (!('code' in result)) throw new Error('expected the post-commit delete to be blocked by the guard');
      expect(result.code).toBe('BLOCKED');
      expect(result.error).toContain('1 comprobante(s)');

      // Every uploaded row remains intact.
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM vouchers_canonical WHERE periodo_alta_id = $1',
        [p1],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      clientA.release();
    }
  });

  it('RF-37 Scenario: delete wins the race — the worker’s INSERT fails on FK violation and its whole job tx rolls back', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-06-15');

    // Delete FIRST, commit, and only then run the worker-style tx against
    // the now-missing período: the INSERT hits an immediate FK violation
    // and nothing of the job survives.
    const result = await eliminarPeriodo(pool, p1);
    expect(result).toEqual({ deleted: true, periodo_id: p1 });

    const clientB = await pool.connect();
    try {
      await clientB.query('BEGIN');
      await clientB.query(
        `INSERT INTO vouchers_staging (tenant_id, raw_data, file_source) VALUES ($1, '{}'::jsonb, 'arca')`,
        [tenantId],
      );
      await expect(
        clientB.query(
          `INSERT INTO vouchers_canonical (
             tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
             file_source, estado, periodo_alta_id
           ) VALUES ($1, '30111111112', 1, 1, 525252, 1000, 'arca', 'pendiente', $2)`,
          [tenantId, p1],
        ),
      ).rejects.toThrow(/violates foreign key constraint/i);
    } finally {
      // The whole "job" rolls back as one unit — zero half-written rows.
      await clientB.query('ROLLBACK').catch(() => undefined);
      clientB.release();
    }

    const { rows: canonicalRows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM vouchers_canonical WHERE periodo_alta_id = $1',
      [p1],
    );
    expect(canonicalRows[0].n).toBe(0);
  });
});
