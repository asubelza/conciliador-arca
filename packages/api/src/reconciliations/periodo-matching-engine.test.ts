import { Pool } from 'pg';
import { matchPeriodo } from './periodo-matching-engine';
import { upsertVouchersCanonical } from './vouchers-canonical-writer';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';
import type { CanonicalVoucher } from 'shared-types';

async function insertConfirmation(
  pool: Pool,
  tenantId: string,
  sistemaVoucherId: string,
  arcaVoucherId: string,
  status: 'confirmado' | 'descartado',
): Promise<void> {
  await pool.query(
    `INSERT INTO fuzzy_match_confirmations (tenant_id, sistema_voucher_id, arca_voucher_id, status)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, sistemaVoucherId, arcaVoucherId, status],
  );
}

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
    estado?: 'pendiente' | 'conciliado' | 'archivado';
    periodoAltaId: string;
    /** Fecha de emisión (RF-19's antiguedad_meses is computed from this, not periodoAltaId — see periodo-matching-engine.ts's fetchViewedPeriodoYearMonth doc). */
    fecha?: string;
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vouchers_canonical (
       tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
       file_source, estado, periodo_alta_id, fecha
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      overrides.fecha ?? null,
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
    await pool.query('DELETE FROM fuzzy_match_confirmations WHERE tenant_id = $1', [tenantId]);
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

  it('RF-19 Scenario: a 3-month-old pendiente voucher (by fecha de emisión) reports antiguedad_meses = 3', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p4 = await createTestPeriodo(pool, tenantId, '2026-04-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, fecha: '2026-01-15' });

    const summary = await matchPeriodo(pool, tenantId, p4, 0.99);
    expect(summary.counts.pendiente_en_arca).toBe(1);
    expect(summary.results[0].antiguedad_meses).toBe(3);
  });

  it('RF-19 (client-confirmed 2026-08-22): antiguedad tracks the real fecha de emisión, not when the file was uploaded/re-uploaded', async () => {
    // The exact scenario the client described: emitted in ARCA in
    // November, but the accounting side only registers it in February —
    // and the ARCA export itself might have been uploaded (or re-uploaded,
    // e.g. as part of an acumulado anual) in February too. periodo_alta_id
    // here is P_feb (upload time) but fecha is November — antiguedad must
    // follow fecha (3 months to April), not periodo_alta_id (which would
    // wrongly say 2 months, Feb->Apr).
    const pFeb = await createTestPeriodo(pool, tenantId, '2026-02-01');
    const pApr = await createTestPeriodo(pool, tenantId, '2026-04-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: pFeb, fecha: '2025-11-20' });

    const summary = await matchPeriodo(pool, tenantId, pApr, 0.99);
    expect(summary.counts.pendiente_en_arca).toBe(1);
    // Nov 2025 -> Apr 2026 = 5 months, definitely not Feb 2026 -> Apr 2026 (2 months).
    expect(summary.results[0].antiguedad_meses).toBe(5);
  });

  it('RF-19: a pendiente voucher with no fecha (never captured) reports antiguedad_meses as undefined, not a wrong number', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p4 = await createTestPeriodo(pool, tenantId, '2026-04-01');
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1 }); // no fecha override -> NULL

    const summary = await matchPeriodo(pool, tenantId, p4, 0.99);
    expect(summary.counts.pendiente_en_arca).toBe(1);
    expect(summary.results[0].antiguedad_meses).toBeUndefined();
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

  /**
   * 2026-10-12 (Histórico filters + "Archivar",
   * 024_alter_vouchers_canonical_estado_add_archivado.sql): an `archivado`
   * ARCA row must get the exact same treatment as `conciliado` in this
   * engine — never offered as a match candidate, never counted as
   * pendiente_en_arca, in either the corriente or histórico pool.
   */
  it('an archivado voucher never appears as pendiente_en_arca (corriente pool), and never matches a sistema row', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const arcaId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      estado: 'archivado',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, importeTotal: 1000 });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99);
    // The sistema row found no ARCA counterpart at all (the archivado row is
    // invisible to the corriente pool query) — reported no_existe_en_arca,
    // not conciliado_ok nor pendiente_en_arca.
    expect(summary.counts.conciliado_ok).toBe(0);
    expect(summary.counts.pendiente_en_arca).toBe(0);
    expect(summary.counts.no_existe_en_arca).toBe(1);
    expect(summary.results.some((r) => r.arca?.id === arcaId)).toBe(false);
  });

  it('an archivado voucher from an earlier período never appears as pendiente_en_arca (histórico pool) in a later período', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const p2 = await createTestPeriodo(pool, tenantId, '2026-02-01');
    const arcaId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      estado: 'archivado',
    });

    const summary = await matchPeriodo(pool, tenantId, p2, 0.99);
    expect(summary.counts.pendiente_en_arca).toBe(0);
    expect(summary.results.some((r) => r.arca?.id === arcaId)).toBe(false);
  });

  it('re-running the upload/upsert path with the same composite key does NOT flip an archivado row back to pendiente', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const client = await pool.connect();
    try {
      const voucher: CanonicalVoucher = {
        cuit_emisor: '30111111112',
        tipo_cbte: 1,
        punto_venta: 1,
        numero: 100,
        fecha_emision: '2026-01-10',
        importe_total_ars: 1000,
        iva: 0,
        moneda: 'ARS',
        file_source: 'arca',
        source_row: {},
      };
      await upsertVouchersCanonical(client, tenantId, p1, [voucher]);
      await pool.query("UPDATE vouchers_canonical SET estado = 'archivado' WHERE tenant_id = $1", [tenantId]);

      // Same composite key, different importe — simulates re-uploading the
      // same ARCA file/range after the voucher was archived.
      const result = await upsertVouchersCanonical(client, tenantId, p1, [
        { ...voucher, importe_total_ars: 9999 },
      ]);
      expect(result).toEqual({ upserted: 0, skippedConciliado: 1 });

      const { rows } = await pool.query(
        "SELECT estado, importe_total::float AS importe_total FROM vouchers_canonical WHERE tenant_id = $1",
        [tenantId],
      );
      expect(rows).toEqual([{ estado: 'archivado', importe_total: 1000 }]);
    } finally {
      client.release();
    }
  });
});

/**
 * RF-04/RF-13 (matching por similitud, autenticacion-roles follow-up):
 * the fallback that runs only once the exact composite key has found
 * nothing anywhere for a sistema row.
 */
describe('RF-04/RF-13: matchPeriodo similarity fallback', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'periodo-matching-engine.similarity.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM fuzzy_match_confirmations WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM periodos WHERE tenant_id = $1', [tenantId]);
  });

  it('a single-digit typo in numero, same fecha/importe, is posible_coincidencia with a reason', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 1235,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 1234,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.posible_coincidencia).toBe(1);
    expect(summary.counts.no_existe_en_arca).toBe(0);
    const result = summary.results.find((r) => r.classification === 'posible_coincidencia');
    expect(result?.arca?.numero).toBe(1235);
    expect(result?.similarity_reason).toContain('1 dígito');
  });

  it('a 2-digit numero difference (not a typo) does NOT match via the typo step — only the separate fecha/importe step can still catch it', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    // Same fecha/importe as the sistema row, so IF the typo step were (wrongly)
    // as lenient as the fecha/importe step, this would still match — the
    // real assertion below is on `similarity_reason`, proving it did NOT
    // come from the typo path (which would also require an exact fecha
    // match, satisfied here, and would report "1 dígito").
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 1299, // Hamming distance 2 from 1234 (positions 2 and 3 differ) — not a single-digit typo
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 1234,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    const result = summary.results.find((r) => r.classification === 'posible_coincidencia');
    // It DOES still match — via the separate, intentionally looser
    // fecha/importe step (numero is free there) — but the reason must say so,
    // never claim a "1 dígito" typo it isn't.
    expect(result?.similarity_reason).not.toContain('1 dígito');
    expect(result?.similarity_reason).toContain('día');
  });

  it('a 2-digit numero difference with fecha ALSO outside tolerance matches neither step — genuinely no candidate', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 1299,
      fecha: '2026-01-20', // 10 days from the sistema row's fecha, tolerance is 5
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 1234,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.posible_coincidencia).toBe(0);
    expect(summary.counts.no_existe_en_arca).toBe(1);
  });

  it('fecha within tolerance + importe within tolerance, different numero, is posible_coincidencia', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 500,
      puntoVenta: 3,
      fecha: '2026-01-12',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 501,
      puntoVenta: 4,
      fecha: '2026-01-10',
      importeTotal: 1000.5,
    });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.posible_coincidencia).toBe(1);
    const result = summary.results.find((r) => r.classification === 'posible_coincidencia');
    expect(result?.similarity_reason).toContain('día');
  });

  it('fecha exactly at the tolerance boundary matches; one day beyond does not', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 900,
      puntoVenta: 9,
      fecha: '2026-01-15',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 901,
      puntoVenta: 8,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });

    const atBoundary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(atBoundary.counts.posible_coincidencia).toBe(1);

    const beyondBoundary = await matchPeriodo(pool, tenantId, p1, 0.99, 4);
    expect(beyondBoundary.counts.posible_coincidencia).toBe(0);
    expect(beyondBoundary.counts.no_existe_en_arca).toBe(1);
  });

  it('a fuzzy match never crosses tipo_cbte, even with identical fecha/importe/numero', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      tipoCbte: 3, // Nota de Crédito A
      numero: 100,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      tipoCbte: 1, // Factura A
      numero: 100,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.posible_coincidencia).toBe(0);
    expect(summary.counts.no_existe_en_arca).toBe(1);
  });

  it('a confirmed pairing is treated exactly like an exact match — consumes the ARCA row, no longer pendiente', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const arcaId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 1235,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    const sistemaId = await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 1234,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    await insertConfirmation(pool, tenantId, sistemaId, arcaId, 'confirmado');

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.posible_coincidencia).toBe(0);
    expect(summary.counts.pendiente_en_arca).toBe(0);
    expect(summary.counts.conciliado_ok).toBe(1);
    const match = summary.results.find((r) => r.classification === 'conciliado_ok');
    expect(match?.matched_via).toBe('similitud_confirmada');
    expect(match?.arca?.id).toBe(arcaId);
  });

  it('a descartado pairing is never suggested again for that exact sistema/arca pair', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    const arcaId = await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 1235,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    const sistemaId = await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 1234,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });
    await insertConfirmation(pool, tenantId, sistemaId, arcaId, 'descartado');

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.posible_coincidencia).toBe(0);
    expect(summary.counts.no_existe_en_arca).toBe(1);
    // The ARCA row itself is untouched — still shows up as pendiente, same
    // as if no candidate had ever been suggested.
    expect(summary.counts.pendiente_en_arca).toBe(1);
  });

  it('an already-consumed ARCA row (matched exactly by someone else) is never offered as a fuzzy candidate too', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    // Exact match pair.
    await insertVoucher(pool, tenantId, { fileSource: 'arca', periodoAltaId: p1, numero: 1234, fecha: '2026-01-10', importeTotal: 1000 });
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1234, fecha: '2026-01-10', importeTotal: 1000 });
    // A second sistema row that would fuzzy-candidate onto the SAME arca
    // voucher above (numero typo) if it weren't already consumed.
    await insertVoucher(pool, tenantId, { fileSource: 'contabilidad', periodoAltaId: p1, numero: 1235, puntoVenta: 1, fecha: '2026-01-10', importeTotal: 1000 });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99, 5);
    expect(summary.counts.conciliado_ok).toBe(1);
    expect(summary.counts.posible_coincidencia).toBe(0);
    expect(summary.counts.no_existe_en_arca).toBe(1);
  });

  it('default toleranciaDiasFecha (omitted) never suggests a fecha/importe-only candidate — backward compatible with existing callers', async () => {
    const p1 = await createTestPeriodo(pool, tenantId, '2026-01-01');
    await insertVoucher(pool, tenantId, {
      fileSource: 'arca',
      periodoAltaId: p1,
      numero: 500,
      puntoVenta: 3,
      fecha: '2026-01-11',
      importeTotal: 1000,
    });
    await insertVoucher(pool, tenantId, {
      fileSource: 'contabilidad',
      periodoAltaId: p1,
      numero: 501,
      puntoVenta: 4,
      fecha: '2026-01-10',
      importeTotal: 1000,
    });

    const summary = await matchPeriodo(pool, tenantId, p1, 0.99); // no 5th arg
    expect(summary.counts.posible_coincidencia).toBe(0);
    expect(summary.counts.no_existe_en_arca).toBe(1);
  });
});
