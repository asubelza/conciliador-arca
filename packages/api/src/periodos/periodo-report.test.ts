import { Pool } from 'pg';
import { getPeriodoReport } from './periodo-report';
import { cerrarPeriodo } from './periodo-cierre';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T29 — RF-22/RF-23
 * (openspec/specs/conciliacion-periodica/reconciliation-reporting-periodica.spec.md),
 * against real Postgres.
 */
async function insertVoucher(
  pool: Pool,
  tenantId: string,
  overrides: {
    numero?: number;
    importeTotal?: number;
    fileSource: 'arca' | 'contabilidad';
    periodoAltaId: string;
    /** Fecha de emisión — RF-19's antiguedad_meses is computed from this, not periodoAltaId (see periodo-matching-engine.ts). */
    fecha?: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO vouchers_canonical (
       tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
       file_source, estado, periodo_alta_id, fecha
     ) VALUES ($1, '30111111112', 1, 1, $2, $3, $4, 'pendiente', $5, $6)`,
    [
      tenantId,
      overrides.numero ?? 1,
      overrides.importeTotal ?? 1000,
      overrides.fileSource,
      overrides.periodoAltaId,
      overrides.fecha ?? null,
    ],
  );
}

describe('T29: getPeriodoReport (RF-22, RF-23)', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-report.test');
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

  it('returns a typed 404 failure for an unknown período id', async () => {
    const result = await getPeriodoReport(pool, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ code: 'NOT_FOUND', status: 404, error: 'período not found' });
  });

  it('RF-22 Scenario: an open período\'s report is a live view, con_divergencia under Discrepancias', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1, importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1, importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 2, importeTotal: 500 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 2, importeTotal: 490 });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 3, importeTotal: 300, fecha: '2026-01-10' });

    const result = await getPeriodoReport(pool, p1);
    if ('code' in result) throw new Error('expected success');
    expect(result.live).toBe(true);
    expect(result.periodo.estado).toBe('abierto');
    expect(result.sections.conciliados_ok).toHaveLength(1);
    expect(result.sections.discrepancias_y_alertas).toHaveLength(1);
    expect(result.sections.discrepancias_y_alertas[0].classification).toBe('con_divergencia');
    expect(result.sections.pendientes_en_arca).toHaveLength(1);
    expect(result.sections.pendientes_en_arca[0].antiguedad_meses).toBe(0);
  });

  it('RF-22 Scenario: a closed período\'s report reflects its frozen snapshot, not a live recompute', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1, importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1, importeTotal: 1000 });

    const closed = await cerrarPeriodo(pool, p1, null);
    if ('code' in closed) throw new Error('expected close to succeed');

    // Mutate vouchers_canonical directly after close — a live recompute
    // would see this; the frozen report must not.
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 99, importeTotal: 1 });

    const result = await getPeriodoReport(pool, p1);
    if ('code' in result) throw new Error('expected success');
    expect(result.live).toBe(false);
    expect(result.periodo.estado).toBe('cerrado');
    expect(result.sections.conciliados_ok).toHaveLength(1);
    expect(result.sections.pendientes_en_arca).toHaveLength(0); // the post-close insert never enters the frozen snapshot
  });

  it('RF-23 Scenario: a closed período distinguishes an accepted divergence from an exact match', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1, importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1, importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 2, importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 2, importeTotal: 997 });

    const closed = await cerrarPeriodo(pool, p1, null);
    if ('code' in closed) throw new Error('expected close to succeed');

    const result = await getPeriodoReport(pool, p1);
    if ('code' in result) throw new Error('expected success');
    // Both matches land in Conciliados OK once closed (RF-20 conciliated both) ...
    expect(result.sections.conciliados_ok).toHaveLength(2);
    // ... but the one with a real gap still carries divergencia_ars, so the
    // UI can tell it apart from the zero-difference exact match.
    const exact = result.sections.conciliados_ok.find((r) => r.composite_key.endsWith('|1'));
    const divergente = result.sections.conciliados_ok.find((r) => r.composite_key.endsWith('|2'));
    expect(exact?.divergencia_ars).toBeNull();
    expect(divergente?.divergencia_ars).toBeCloseTo(3.0);
    // And it no longer appears in Discrepancias — it was resolved by closing.
    expect(result.sections.discrepancias_y_alertas).toHaveLength(0);
  });

  it('tenant isolation: another tenant’s vouchers never enter this tenant’s report', async () => {
    const otherTenantId = await createTestTenant(pool, 'periodo-report.test (other)');
    try {
      const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
      const otherPeriodo = await createTestPeriodo(pool, otherTenantId, '2026-01-01');
      await insertVoucher(pool, otherTenantId, { fileSource: 'arca', periodoAltaId: otherPeriodo, numero: 1 });
      await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1 });

      const result = await getPeriodoReport(pool, p1);
      if ('code' in result) throw new Error('expected success');
      expect(result.sections.discrepancias_y_alertas).toHaveLength(1);
      expect(result.sections.discrepancias_y_alertas[0].classification).toBe('no_existe_en_arca');
    } finally {
      await deleteTestTenant(pool, otherTenantId);
    }
  });
});
