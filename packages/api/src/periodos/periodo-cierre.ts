/**
 * periodo-cierre.ts — T27/T28 (RF-20/RF-21,
 * openspec/specs/conciliacion-periodica/cierre-de-mes.spec.md): "Cerrar
 * Conciliación del Mes".
 *
 * Runs `matchPeriodo()` against the transaction's own `PoolClient` (not the
 * shared `Pool`) so the match and every write it feeds — conciliating
 * vouchers_canonical rows, freezing the périodo_resultados snapshot, and
 * flipping periodos.estado — happen inside one transaction, per RF-20's
 * "within a single transaction" requirement. A failure at any step rolls
 * everything back: a período is never left half-closed.
 *
 * "Rollover" of unmatched ARCA vouchers (RF-20 scenario 2) needs no code of
 * its own here — those rows are simply never touched by this function, so
 * they stay `estado = 'pendiente'` with their original `periodo_alta_id`,
 * which is exactly what makes them visible to a later período's
 * `matchPeriodo()` historical pool (RF-16 step 3).
 */
import type { Pool, PoolClient } from 'pg';
import { matchPeriodo, PeriodoMatchCounts, PeriodoMatchResult } from '../reconciliations/periodo-matching-engine';
import { logAuditEvent } from '../reconciliations/audit-logger';

export type PeriodoCierreFailure =
  | { code: 'NOT_FOUND'; status: 404; error: string }
  | { code: 'ALREADY_CERRADO'; status: 409; error: string };

export interface PeriodoCierreResult {
  periodo: {
    id: string;
    tenant_id: string;
    mes: string;
    estado: 'cerrado';
    tolerancia_ars: string;
    cerrado_at: string;
    cerrado_por: string | null;
  };
  counts: PeriodoMatchCounts;
}

interface PeriodoRowForCierre {
  id: string;
  tenant_id: string;
  estado: 'abierto' | 'cerrado';
}

/** The two `vouchers_canonical` ids a matched result touches (sistema + arca side, when both are present). */
function idsToConciliate(result: PeriodoMatchResult): string[] {
  const ids: string[] = [];
  if (result.sistema) ids.push(result.sistema.id);
  if (result.arca) ids.push(result.arca.id);
  return ids;
}

async function insertResultadosSnapshot(
  client: PoolClient,
  tenantId: string,
  periodoId: string,
  results: PeriodoMatchResult[],
): Promise<void> {
  for (const r of results) {
    await client.query(
      `INSERT INTO periodo_resultados (
         tenant_id, periodo_id, classification, composite_key,
         sistema_row, arca_row, delta, antiguedad_meses, similarity_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        periodoId,
        r.classification,
        r.composite_key,
        r.sistema ? JSON.stringify(r.sistema) : null,
        r.arca ? JSON.stringify(r.arca) : null,
        r.delta ?? null,
        r.antiguedad_meses ?? null,
        r.similarity_reason ?? null,
      ],
    );
  }
}

/**
 * RF-20/RF-21: closes a período. Returns a typed failure (never throws for
 * the expected not-found/already-closed cases) so the controller can map it
 * to the right HTTP status, same style as periodo-upload-guard.ts.
 */
export async function cerrarPeriodo(
  pool: Pool,
  periodoId: string,
  cerradoPor: string | null,
): Promise<PeriodoCierreResult | PeriodoCierreFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: periodoRows } = await client.query<PeriodoRowForCierre>(
      'SELECT id, tenant_id, estado FROM periodos WHERE id = $1 FOR UPDATE',
      [periodoId],
    );
    if (periodoRows.length === 0) {
      await client.query('ROLLBACK');
      return { code: 'NOT_FOUND', status: 404, error: 'período not found' };
    }
    const periodo = periodoRows[0];
    // RF-20 scenario "closing an already-closed período is rejected" (409).
    // `SELECT ... FOR UPDATE` above also makes this the authoritative,
    // race-safe check: a concurrent second `cerrar` call blocks on the row
    // lock until the first commits, then sees `estado = 'cerrado'` here and
    // is rejected too — closing never runs twice for the same período.
    if (periodo.estado === 'cerrado') {
      await client.query('ROLLBACK');
      return { code: 'ALREADY_CERRADO', status: 409, error: 'período is already cerrado' };
    }

    const { rows: tenantRows } = await client.query<{ tolerancia_redondeo_ars: string; tolerancia_dias_fecha: number }>(
      'SELECT tolerancia_redondeo_ars, tolerancia_dias_fecha FROM tenants WHERE id = $1',
      [periodo.tenant_id],
    );
    const toleranciaArs = Number(tenantRows[0]?.tolerancia_redondeo_ars ?? 0.99);
    const toleranciaDiasFecha = tenantRows[0]?.tolerancia_dias_fecha ?? 5;

    const { results, counts } = await matchPeriodo(client, periodo.tenant_id, periodoId, toleranciaArs, toleranciaDiasFecha);

    // RF-20(2): every conciliado_ok / con_divergencia match's vouchers_canonical
    // row(s) — sistema side and/or arca side — become estado = 'conciliado',
    // periodo_cierre_id = this período. Rows left pendiente_en_arca or
    // no_existe_en_arca/posible_duplicado_en_sistema (sistema-only rows
    // never had a vouchers_canonical row of their own beyond what the
    // upsert already wrote as pendiente) are left untouched.
    const conciliateIds = results
      .filter((r) => r.classification === 'conciliado_ok' || r.classification === 'con_divergencia')
      .flatMap(idsToConciliate);
    if (conciliateIds.length > 0) {
      await client.query(
        `UPDATE vouchers_canonical
            SET estado = 'conciliado', periodo_cierre_id = $2
          WHERE id = ANY($1::uuid[])`,
        [conciliateIds, periodoId],
      );
    }

    // RF-20(4): freeze the immutable snapshot before flipping estado, same
    // transaction — a crash between these two statements rolls back both.
    await insertResultadosSnapshot(client, periodo.tenant_id, periodoId, results);

    // RF-21: snapshot the tolerance that was actually applied.
    const { rows: closedRows } = await client.query<{
      id: string;
      tenant_id: string;
      mes: string;
      estado: 'cerrado';
      tolerancia_ars: string;
      cerrado_at: string;
      cerrado_por: string | null;
    }>(
      `UPDATE periodos
          SET estado = 'cerrado', tolerancia_ars = $2, cerrado_at = now(), cerrado_por = $3
        WHERE id = $1
        RETURNING id, tenant_id, mes::text AS mes, estado, tolerancia_ars, cerrado_at::text AS cerrado_at, cerrado_por`,
      [periodoId, toleranciaArs, cerradoPor],
    );

    // `cerrado_por` is a free-text label (no auth/user system exists yet —
    // see periodos-validation.ts's validateCerrarBody doc), not necessarily
    // a UUID, so it can't be passed as audit_trail.user_id (UUID column,
    // 006_init_audit_trail.sql) — it goes into `details` instead.
    await logAuditEvent(client, {
      tenantId: periodo.tenant_id,
      action: 'close',
      entity: 'periodo',
      entityId: periodoId,
      details: { ...counts, tolerancia_ars: toleranciaArs, cerrado_por: cerradoPor },
    });

    await client.query('COMMIT');

    return { periodo: closedRows[0], counts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
