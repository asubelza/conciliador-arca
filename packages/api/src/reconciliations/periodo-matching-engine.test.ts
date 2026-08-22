import { Pool } from 'pg';
import { matchPeriodo } from './periodo-matching-engine';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T23–T26 — RF-16 through RF-19
 * (openspec/specs/conciliacion-periodica/matching-periodico.spec.md).
 *
 * Each `it` below maps directly to one Given/When/Then scenario from the
 * spec, against real Postgres — fixtures are inserted straight into
 * vouchers_canonical via SQL (not through upsertVouchersCanonical) so each
 * test can set up estado/periodo_alta_id precisely, independent of the
 * upsert module's own (separately-tested) periodo_alta_id semantics.
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

describe('T23–T26: matchPeriodo (RF-16, RF-17, RF-18, RF-19)', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-matching-engine.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
  });

  it('RF-16 Scenario: Match Corriente is found for its own key and leaves an unrelated historical pendiente row untouched', async () => {
    // Note on this fixture vs. the spec's literal wording: RF-16's scenario
    // describes "an unrelated pendiente voucher with the SAME composite key"
    // existing simultaneously in history — that's not constructible given
    // idx_vouchers_tenant_key_unique (RF-15), which allows exactly one row
    // per (tenant, file_source, cuit, tipo, PV, numero) regardless of
    // período; two rows sharing a composite key are definitionally the same
    // row. This test instead proves the equivalent real guarantee: a P2
    // corriente match is found by its own key, and a genuinely different
    // (different `numero`) P1 historical pendiente row is left untouched —
    // corriente and histórico never interfere with each other.
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p2 = await createTestPeriodo(pool, tenantId, '2026-02-01');

    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p2, numero: 1, importeTotal: 1000 });
    const historicoId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 2,
      importeTotal: 500,
    });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p2, numero: 1, importeTotal: 1000 });

    const summary = await matchPeriodo(pool, tenantId, p2, 0.99);
    expect(summary.counts.conciliado_ok).toBe(1);
    const match = summary.results.find((r) => r.classification === 'conciliado_ok');
    expect(match?.match_source).toBe('corriente');
    expect(match?.arca?.periodo_alta_id).toBe(p2);

    // The unrelated P1 historical row was left alone — still pendiente,
    // reported as pendiente_en_arca (it's from an older período, and no
    // sistema row this run had its composite key).
    const historico = summary.results.find((r) => r.arca?.id === historicoId);
    expect(historico?.classification).toBe('pendiente_en_arca');
  });

  it('RF-16 Scenario: Match Histórico — a later período matches a still-pendiente voucher from an earlier one', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p2 = await createTestPeriodo(pool, tenantId, '2026-04-01');

    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, importeTotal: 2000 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p2, importeTotal: 2000 });

    const summary = await matchPeriodo(pool, tenantId, p2, 0.99);
    expect(summary.counts.conciliado_ok).toBe(1);
    const match = summary.results.find((r) => r.classification === 'conciliado_ok');
    expect(match?.match_source).toBe('historico');
    expect(match?.arca?.periodo_alta_id).toBe(p1);
  });

  it('RF-16 Scenario: a conciliado voucher is never returned as a match candidate — routes to RF-17 instead', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p2 = await createTestPeriodo(pool, tenantId, '2026-02-01');

    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, estado: 'conciliado' });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p2 });

    const summary = await matchPeriodo(pool, tenantId, p2, 0.99);
    expect(summary.counts.conciliado_ok).toBe(0);
    expect(summary.counts.con_divergencia).toBe(0);
    expect(summary.counts.posible_duplicado_en_sistema).toBe(1);
  });

  it('RF-17 Scenario: re-entering an already-conciliado voucher is posible_duplicado_en_sistema, not no_existe_en_arca', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p2 = await createTestPeriodo(pool, tenantId, '2026-02-01');

    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      estado: 'conciliado',
      numero: 500,
    });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p2, numero: 500 });

    const summary = await matchPeriodo(pool, tenantId, p2, 0.99);
    const result = summary.results.find((r) => r.sistema !== undefined);
    expect(result?.classification).toBe('posible_duplicado_en_sistema');
  });

  it('RF-17 Scenario: a genuinely new sistema voucher with no ARCA history at all is a plain discrepancy', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 999 });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99);
    expect(summary.counts.no_existe_en_arca).toBe(1);
    expect(summary.counts.posible_duplicado_en_sistema).toBe(0);
  });

  it('RF-18 Scenario: difference within tolerance is a clean match', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, importeTotal: 1000.0 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, importeTotal: 999.5 });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99);
    expect(summary.counts.conciliado_ok).toBe(1);
    expect(summary.counts.con_divergencia).toBe(0);
    expect(summary.results.find((r) => r.classification === 'conciliado_ok')?.delta).toBeCloseTo(0.5);
  });

  it('RF-18 Scenario: difference exceeding tolerance is con_divergencia, carrying the delta', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, importeTotal: 1000.0 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, importeTotal: 995.0 });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99);
    expect(summary.counts.con_divergencia).toBe(1);
    expect(summary.counts.conciliado_ok).toBe(0);
    expect(summary.results.find((r) => r.classification === 'con_divergencia')?.delta).toBeCloseTo(5.0);
  });

  it('RF-18 Scenario: two tenants apply their own tolerance to the same $2.00 difference', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, importeTotal: 1000.0 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, importeTotal: 998.0 });

    const strict = await matchPeriodo(pool, tenantId, p1, 0.99);
    expect(strict.counts.con_divergencia).toBe(1); // 2.00 > 0.99

    const lenient = await matchPeriodo(pool, tenantId, p1, 5.0);
    expect(lenient.counts.conciliado_ok).toBe(1); // 2.00 <= 5.00
  });

  it('RF-19 Scenario: a 3-month-old pendiente voucher reports antiguedad_meses = 3', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p4 = await createTestPeriodo(pool, tenantId, '2026-04-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1 });

    const summary = await matchPeriodo(pool, tenantId, p4, 0.99);
    expect(summary.counts.pendiente_en_arca).toBe(1);
    expect(summary.results[0].antiguedad_meses).toBe(3);
  });

  it('tenant isolation: another tenant’s vouchers never enter this tenant’s match', async () => {
    const otherTenantId = await createTestTenant(pool, 'periodo-matching-engine.test (other)');
    try {
      const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
      const otherPeriodo = await createTestPeriodo(pool, otherTenantId, '2026-01-01');
      await insertVoucher(pool, otherTenantId, { fileSource: 'arca', periodoAltaId: otherPeriodo });
      await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1 });

      const summary = await matchPeriodo(pool, tenantId, p1, 0.99);
      expect(summary.counts.no_existe_en_arca).toBe(1);
      expect(summary.counts.conciliado_ok).toBe(0);
    } finally {
      await deleteTestTenant(pool, otherTenantId);
    }
  });
});
