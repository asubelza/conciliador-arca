/**
 * pendientes-historico.ts — Feature 3 (client request, 2026-08-23, "feature
 * 3 de 3"): a tenant-wide, all-períodos summary of ARCA vouchers still
 * `estado = 'pendiente'` — the same "Pendientes en ARCA" pool
 * periodo-matching-engine.ts draws from for a single período's report, but
 * queried here directly across every período the tenant has ever had,
 * reachable after "finalizar" a período (see PeriodoReportViewer.tsx).
 *
 * Purpose (confirmed with the client 2026-08-23): a guard rail against the
 * client mistakenly uploading a historical ARCA file. The filter boundary
 * is the tenant's own alta (sign-up) date — `tenants.created_at` — per the
 * client's own answer when asked how "the month the client first started
 * using the system" should be defined: "Lo definiriamos tomando como
 * inicio el dia que el cliente se dio de alta en el sistema."
 *
 * A pendiente ARCA row dated before that alta date predates the tool
 * entirely (it was never going to be loaded into the sistema contable
 * through this workflow) and would otherwise permanently clutter this
 * screen. RNF-07 ("nunca ocultar" — see periodo-matching-engine.ts's own
 * module doc and periodo-report.ts's feedback_previo handling) rules out
 * silently dropping those older rows, though: they're returned in a
 * clearly separate, equally visible bucket instead
 * (`excluidos_previos_a_alta`), with their own count, never invisible even
 * though they're excluded from the main `pendientes` list.
 *
 * A row with no `fecha` at all can't be proven to be on either side of the
 * alta boundary — it is excluded (same bucket) rather than guessed into
 * `pendientes`, for the same "never silently claim something you can't
 * verify" reason RNF-07 exists for.
 */
import type { Pool } from 'pg';
import type { VoucherCanonicalRow } from '../reconciliations/periodo-matching-engine';

export type PendientesHistoricoFailure = { code: 'NOT_FOUND'; status: 404; error: string };

export interface PendientesHistoricoRow extends VoucherCanonicalRow {
  /**
   * Meses transcurridos entre `fecha` (fecha de emisión real en ARCA) y
   * hoy — mismo criterio de cálculo que RF-19's antiguedad_meses
   * (diferencia de mes calendario, no de días), pero medido contra la
   * fecha actual real en vez de contra el mes de un período específico,
   * porque esta pantalla no está atada a ningún período. `null` cuando la
   * fila no tiene `fecha`.
   */
  antiguedad_meses: number | null;
}

export interface PendientesHistoricoResult {
  tenant: { id: string; name: string; created_at: string };
  pendientes: PendientesHistoricoRow[];
  count_pendientes: number;
  excluidos_previos_a_alta: PendientesHistoricoRow[];
  count_excluidos_previos_a_alta: number;
  /**
   * 2026-10-12 (Histórico filters + "Archivar"): every ARCA voucher a
   * contador has deliberately archived (POST
   * /api/tenants/:id/comprobantes/:voucherId/archivar or .../archivar-lote)
   * — a third, equally visible bucket so "ver archivados" on the Histórico
   * screen can show exactly what was archived and when, instead of those
   * rows simply disappearing from `pendientes` with no trace (same RNF-07
   * "nunca ocultar" posture as excluidos_previos_a_alta above). Not
   * filtered by the alta-date boundary — unlike `pendientes`/
   * `excluidos_previos_a_alta`, archiving is an explicit human decision, so
   * there's no "predates the tool" ambiguity to split on here.
   */
  archivados: PendientesHistoricoRow[];
  count_archivados: number;
}

const ROW_COLUMNS = `
  id, cuit_emisor, tipo_cbte, punto_venta, numero,
  importe_total::float AS importe_total, iva, fecha::text AS fecha,
  file_source, estado, periodo_alta_id
`;

/** Same calendar-month-difference formula as periodo-matching-engine.ts's antiguedad_meses (RF-19) — both operands are 'YYYY-MM-DD' text. */
function monthsBetween(fecha: string, hoy: string): number {
  const [anioFecha, mesFecha] = fecha.split('-').map(Number);
  const [anioHoy, mesHoy] = hoy.split('-').map(Number);
  return (anioHoy - anioFecha) * 12 + (mesHoy - mesFecha);
}

export async function fetchPendientesHistorico(
  pool: Pick<Pool, 'query'>,
  tenantId: string,
): Promise<PendientesHistoricoResult | PendientesHistoricoFailure> {
  const { rows: tenantRows } = await pool.query<{ id: string; name: string; created_at: string }>(
    'SELECT id, name, created_at::text AS created_at FROM tenants WHERE id = $1',
    [tenantId],
  );
  if (tenantRows.length === 0) {
    return { code: 'NOT_FOUND', status: 404, error: 'tenant not found' };
  }
  const tenant = tenantRows[0];
  // tenant.created_at comes back as a TIMESTAMPTZ's text form
  // ('YYYY-MM-DD HH:MI:SS+TZ') — only the calendar date matters for this
  // boundary, same 'YYYY-MM-DD' shape as ROW_COLUMNS' fecha::text.
  const altaFecha = tenant.created_at.slice(0, 10);

  const { rows } = await pool.query<VoucherCanonicalRow>(
    `SELECT ${ROW_COLUMNS} FROM vouchers_canonical
     WHERE tenant_id = $1 AND file_source = 'arca' AND estado = 'pendiente'
     ORDER BY fecha ASC NULLS FIRST`,
    [tenantId],
  );

  const hoy = new Date().toISOString().slice(0, 10);
  const withAntiguedad = (row: VoucherCanonicalRow): PendientesHistoricoRow => ({
    ...row,
    antiguedad_meses: row.fecha ? monthsBetween(row.fecha, hoy) : null,
  });

  const pendientes: PendientesHistoricoRow[] = [];
  const excluidos: PendientesHistoricoRow[] = [];
  for (const row of rows) {
    if (row.fecha && row.fecha >= altaFecha) {
      pendientes.push(withAntiguedad(row));
    } else {
      excluidos.push(withAntiguedad(row));
    }
  }

  // 2026-10-12 (Histórico filters + "Archivar"): a separate, unfiltered
  // bucket — see PendientesHistoricoResult.archivados' own doc above for
  // why this one isn't split by alta date the way pendientes/excluidos is.
  const { rows: archivadoRows } = await pool.query<VoucherCanonicalRow>(
    `SELECT ${ROW_COLUMNS} FROM vouchers_canonical
     WHERE tenant_id = $1 AND file_source = 'arca' AND estado = 'archivado'
     ORDER BY fecha ASC NULLS FIRST`,
    [tenantId],
  );
  const archivados = archivadoRows.map(withAntiguedad);

  return {
    tenant,
    pendientes,
    count_pendientes: pendientes.length,
    excluidos_previos_a_alta: excluidos,
    count_excluidos_previos_a_alta: excluidos.length,
    archivados,
    count_archivados: archivados.length,
  };
}
