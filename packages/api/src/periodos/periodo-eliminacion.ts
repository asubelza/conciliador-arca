/**
 * periodo-eliminacion.ts — T54/T55 (RF-35..RF-38,
 * openspec/specs/dashboard-principal/periodo-eliminacion.spec.md): physical
 * delete of a período, guarded by the HYBRID zero-reference check.
 *
 * AD-2: the guard runs inside ONE transaction that first takes the same
 * `SELECT ... FOR UPDATE` row lock cierre/reopen take — serializing against
 * them — and then counts both reference families:
 *
 *   c1 = vouchers_canonical stamped periodo_alta_id OR periodo_cierre_id
 *   c2 = frozen periodo_resultados snapshot rows (catches a cerrado período
 *        whose matching run left rows even with zero voucher references)
 *
 * If anything references it: ROLLBACK + typed BLOCKED failure whose plain
 * `{ error }` message names both counts verbatim (AD-3 — house shape,
 * surfaced verbatim by the UI). When both are zero the row is physically
 * DELETEd — there is no soft-delete column; the FK graph guarantees no
 * orphans because every referencing table was just counted to zero.
 *
 * Why the row lock suffices against concurrent uploads (RF-37): each
 * worker INSERT with periodo_alta_id takes a Postgres FK `FOR KEY SHARE`
 * lock on this periodos row inside its own single-tx job. Upload commits
 * first → our FOR UPDATE unblocks, counts > 0 → 409 with all data intact.
 * Delete commits first → the worker's INSERT fails immediately on the FK
 * violation and its WHOLE tx rolls back together — no hot-path change
 * needed or allowed by the spec.
 */
import type { Pool } from 'pg';
import { logAuditEvent } from '../reconciliations/audit-logger';

export type PeriodoEliminacionFailure =
  | { code: 'NOT_FOUND'; status: 404; error: string }
  | { code: 'BLOCKED'; status: 409; error: string };

/**
 * Mirrors shared-types' PeriodoDeleteResponse (design §Interfaces).
 */
export interface PeriodoEliminacionResult {
  deleted: true;
  periodo_id: string;
}

interface PeriodoRowForEliminacion {
  id: string;
  tenant_id: string;
  estado: 'abierto' | 'cerrado';
}

/**
 * RF-35..RF-38: deletes an empty período. Returns a typed failure (never
 * throws for the expected not-found/blocked cases) so the controller can
 * map it to the right HTTP status, same style as periodo-cierre.ts /
 * periodo-reapertura.ts.
 */
export async function eliminarPeriodo(pool: Pool, periodoId: string): Promise<PeriodoEliminacionResult | PeriodoEliminacionFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The serialization point (AD-2): same lock cierre/reopen take, plus
    // the FK key-share interplay against in-flight uploads described above.
    const { rows: periodoRows } = await client.query<PeriodoRowForEliminacion>(
      'SELECT id, tenant_id, estado FROM periodos WHERE id = $1 FOR UPDATE',
      [periodoId],
    );
    if (periodoRows.length === 0) {
      await client.query('ROLLBACK');
      return { code: 'NOT_FOUND', status: 404, error: 'período not found' };
    }
    const periodo = periodoRows[0];

    // RF-36: the hybrid guard's two counts, in the same tx as the delete.
    const { rows: c1Rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM vouchers_canonical WHERE periodo_alta_id = $1 OR periodo_cierre_id = $1`,
      [periodoId],
    );
    const { rows: c2Rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM periodo_resultados WHERE periodo_id = $1`,
      [periodoId],
    );
    const c1 = c1Rows[0].n;
    const c2 = c2Rows[0].n;

    if (c1 + c2 > 0) {
      // AD-3: plain `{ error }` string naming BOTH counts verbatim — the UI
      // surfaces it as-is (readErrorMessage reads body.error).
      await client.query('ROLLBACK');
      return {
        code: 'BLOCKED',
        status: 409,
        error: `cannot delete período: ${c1} comprobante(s) and ${c2} frozen resultado row(s) reference it — only an empty período can be deleted`,
      };
    }

    // Zero references: physically delete. No tombstone column involved.
    await client.query('DELETE FROM periodos WHERE id = $1', [periodoId]);

    // Audited INSIDE this transaction — a blocked/rolled-back attempt never
    // leaves an audit row behind.
    await logAuditEvent(client, {
      tenantId: periodo.tenant_id,
      action: 'delete',
      entity: 'periodo',
      entityId: periodoId,
      details: null,
    });

    await client.query('COMMIT');

    return { deleted: true, periodo_id: periodoId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
