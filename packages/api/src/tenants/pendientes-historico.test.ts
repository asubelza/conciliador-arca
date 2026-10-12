import { Pool } from 'pg';
import { fetchPendientesHistorico } from './pendientes-historico';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * 2026-08-23 (feature 3 de 3) — against real Postgres, same style as
 * periodo-report.test.ts: exercises fetchPendientesHistorico() directly,
 * independent of the controller's HTTP wiring (covered separately in
 * tenants.controller.test.ts).
 */
/**
 * `periodo_alta_id` is a nullable FK to `periodos(id)` — left NULL here
 * deliberately (rather than a real período) since fetchPendientesHistorico
 * doesn't consult it at all, it queries vouchers_canonical directly across
 * every período the tenant ever had.
 */
async function insertVoucher(
  pool: Pool,
  tenantId: string,
  overrides: {
    numero?: number;
    fileSource?: 'arca' | 'contabilidad';
    estado?: 'pendiente' | 'conciliado' | 'archivado';
    fecha?: string | null;
  } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO vouchers_canonical (
       tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
       file_source, estado, periodo_alta_id, fecha
     ) VALUES ($1, '30111111112', 1, 1, $2, 1000, $3, $4, NULL, $5)
     RETURNING id`,
    [
      tenantId,
      overrides.numero ?? Math.floor(Math.random() * 1_000_000),
      overrides.fileSource ?? 'arca',
      overrides.estado ?? 'pendiente',
      overrides.fecha ?? null,
    ],
  );
  return rows[0].id;
}

describe('2026-08-23 (feature 3 de 3): fetchPendientesHistorico', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns a typed 404 failure for an unknown tenant id', async () => {
    const result = await fetchPendientesHistorico(pool, '00000000-0000-0000-0000-000000000000');
    expect(result).toEqual({ code: 'NOT_FOUND', status: 404, error: 'tenant not found' });
  });

  it('splits pendiente ARCA vouchers by the tenant alta date, with antiguedad_meses and visible counts on both sides', async () => {
    const tenantId = await createTestTenant(pool, 'pendientes-historico.test (split)', '2026-03-01T00:00:00Z');
    try {
      const afterAltaId = await insertVoucher(pool, tenantId, { fecha: '2026-04-15' });
      const beforeAltaId = await insertVoucher(pool, tenantId, { fecha: '2025-11-01' });
      const onAltaDayId = await insertVoucher(pool, tenantId, { fecha: '2026-03-01' });
      const noFechaId = await insertVoucher(pool, tenantId, { fecha: null });
      // control rows that must NOT appear anywhere in the result
      const conciliadoId = await insertVoucher(pool, tenantId, { fecha: '2026-05-01', estado: 'conciliado' });
      const sistemaSideId = await insertVoucher(pool, tenantId, { fecha: '2026-05-01', fileSource: 'contabilidad' });

      const result = await fetchPendientesHistorico(pool, tenantId);
      if ('code' in result) throw new Error('expected a result, got a failure');

      expect(result.tenant.id).toBe(tenantId);
      expect(result.tenant.created_at.slice(0, 10)).toBe('2026-03-01');

      const pendienteIds = result.pendientes.map((r) => r.id).sort();
      expect(pendienteIds).toEqual([afterAltaId, onAltaDayId].sort());
      expect(result.count_pendientes).toBe(2);

      const excluidoIds = result.excluidos_previos_a_alta.map((r) => r.id).sort();
      expect(excluidoIds).toEqual([beforeAltaId, noFechaId].sort());
      expect(result.count_excluidos_previos_a_alta).toBe(2);

      const allReturnedIds = [...pendienteIds, ...excluidoIds];
      expect(allReturnedIds).not.toContain(conciliadoId);
      expect(allReturnedIds).not.toContain(sistemaSideId);

      const noFechaRow = result.excluidos_previos_a_alta.find((r) => r.id === noFechaId);
      expect(noFechaRow?.antiguedad_meses).toBeNull();

      const afterAltaRow = result.pendientes.find((r) => r.id === afterAltaId);
      expect(typeof afterAltaRow?.antiguedad_meses).toBe('number');
    } finally {
      await deleteTestTenant(pool, tenantId);
    }
  });

  it('returns empty lists (not an error) for a tenant with no pendiente ARCA vouchers at all', async () => {
    const tenantId = await createTestTenant(pool, 'pendientes-historico.test (empty)');
    try {
      const result = await fetchPendientesHistorico(pool, tenantId);
      if ('code' in result) throw new Error('expected a result, got a failure');
      expect(result.pendientes).toEqual([]);
      expect(result.count_pendientes).toBe(0);
      expect(result.excluidos_previos_a_alta).toEqual([]);
      expect(result.count_excluidos_previos_a_alta).toBe(0);
      expect(result.archivados).toEqual([]);
      expect(result.count_archivados).toBe(0);
    } finally {
      await deleteTestTenant(pool, tenantId);
    }
  });

  /**
   * 2026-10-12 (Histórico filters + "Archivar"): the new third bucket —
   * archivado rows land in `archivados`, never in `pendientes` or
   * `excluidos_previos_a_alta`, regardless of their fecha relative to the
   * tenant's alta date (archiving is an explicit decision, not subject to
   * the alta-date guard rail the other two buckets apply).
   */
  it('archivado ARCA vouchers land in the archivados bucket, not pendientes/excluidos, regardless of fecha', async () => {
    const tenantId = await createTestTenant(pool, 'pendientes-historico.test (archivados)', '2026-03-01T00:00:00Z');
    try {
      const archivadoAfterAltaId = await insertVoucher(pool, tenantId, { fecha: '2026-04-15', estado: 'archivado' });
      const archivadoBeforeAltaId = await insertVoucher(pool, tenantId, { fecha: '2025-11-01', estado: 'archivado' });
      const archivadoNoFechaId = await insertVoucher(pool, tenantId, { fecha: null, estado: 'archivado' });
      const pendienteId = await insertVoucher(pool, tenantId, { fecha: '2026-04-15' });

      const result = await fetchPendientesHistorico(pool, tenantId);
      if ('code' in result) throw new Error('expected a result, got a failure');

      const archivadoIds = result.archivados.map((r) => r.id).sort();
      expect(archivadoIds).toEqual([archivadoAfterAltaId, archivadoBeforeAltaId, archivadoNoFechaId].sort());
      expect(result.count_archivados).toBe(3);

      const pendienteIds = result.pendientes.map((r) => r.id);
      expect(pendienteIds).toEqual([pendienteId]);
      expect(result.excluidos_previos_a_alta).toEqual([]);

      // antiguedad_meses still computed the same way for archivado rows
      const noFechaRow = result.archivados.find((r) => r.id === archivadoNoFechaId);
      expect(noFechaRow?.antiguedad_meses).toBeNull();
      const withFechaRow = result.archivados.find((r) => r.id === archivadoAfterAltaId);
      expect(typeof withFechaRow?.antiguedad_meses).toBe('number');
    } finally {
      await deleteTestTenant(pool, tenantId);
    }
  });
});
