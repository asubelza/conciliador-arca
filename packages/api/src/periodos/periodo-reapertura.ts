/**
 * periodo-reapertura.ts — T52/T53 (RF-31..RF-34,
 * openspec/specs/dashboard-principal/periodo-reapertura.spec.md): "Reabrir"
 * a closed período — the strict inverse of cierre
 * (periodo-cierre.ts's sibling, same single-transaction + typed-failure
 * pattern).
 *
 * AD-1: undo ONLY what cierre wrote, identified by its stamps — never
 * recompute the match in reverse. Concretely, inside ONE transaction:
 *
 *   1. `SELECT ... FOR UPDATE` the periodos row (the same serialization
 *      point cierre uses) and reject `abierto` with ALREADY_ABIERTO — the
 *      mirror of cierre's ALREADY_CERRADO, race-safe for the same reason.
 *   2. Undo cierre's voucher stamping with exactly one statement scoped by
 *      the `periodo_cierre_id` stamp AND `estado = 'conciliado'`: manual
 *      "resolver sin pareja" marks are conciliado WITHOUT a stamp, so they
 *      survive untouched (RF-32). ARCA rollover stock is never touched at
 *      all — pendiente rows keep their original periodo_alta_id.
 *   3. DELETE the frozen periodo_resultados snapshot — the user-approved
 *      append-only exception (cierre-de-mes delta, RF-20); it regenerates
 *      at the next cierre.
 *   4. Reset exactly cierre's column set: estado='abierto',
 *      tolerancia_ars/cerrado_at/cerrado_por all NULL.
 *   5. logAuditEvent('reopen') INSIDE the tx — a rollback removes the audit
 *      row too, so only committed reopens are audited (RF-34).
 *
 * Untouched by design (verified against code): fuzzy_match_confirmations
 * (re-read by the next matchPeriodo), feedback_loop (composite_key-scoped),
 * job-scoped reconciliation_results.
 */
import type { Pool } from 'pg';
import { logAuditEvent } from '../reconciliations/audit-logger';

export type PeriodoReaperturaFailure =
  | { code: 'NOT_FOUND'; status: 404; error: string }
  | { code: 'ALREADY_ABIERTO'; status: 409; error: string };

/**
 * Mirrors shared-types' PeriodoReabrirResponse (design §Interfaces) — the
 * controller returns this object verbatim as JSON.
 */
export interface PeriodoReaperturaResult {
  periodo: {
    id: string;
    tenant_id: string;
    mes: string;
    estado: 'abierto';
    tolerancia_ars: null;
    cerrado_at: null;
    cerrado_por: null;
  };
  counts: {
    vouchers_reabiertos: number;
    resultados_eliminados: number;
  };
}

interface PeriodoRowForReapertura {
  id: string;
  tenant_id: string;
  estado: 'abierto' | 'cerrado';
}

/**
 * RF-31..RF-34: reopens a cerrado período. Returns a typed failure (never
 * throws for the expected not-found/already-open cases) so the controller
 * can map it to the right HTTP status, same style as periodo-cierre.ts.
 */
export async function reabrirPeriodo(pool: Pool, periodoId: string, userId: string): Promise<PeriodoReaperturaResult | PeriodoReaperturaFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Same row lock cierre takes — concurrent reopen/reopen, close/reopen
    // and delete/reopen all serialize here (RF-31's race-safety).
    const { rows: periodoRows } = await client.query<PeriodoRowForReapertura>(
      'SELECT id, tenant_id, estado FROM periodos WHERE id = $1 FOR UPDATE',
      [periodoId],
    );
    if (periodoRows.length === 0) {
      await client.query('ROLLBACK');
      return { code: 'NOT_FOUND', status: 404, error: 'período not found' };
    }
    const periodo = periodoRows[0];
    // RF-31 scenario "already-open período is rejected" (409). Race-safe:
    // a concurrent second reabrir blocks on the row lock until the first
    // commits, then sees estado = 'abierto' and is rejected too.
    if (periodo.estado === 'abierto') {
      await client.query('ROLLBACK');
      return { code: 'ALREADY_ABIERTO', status: 409, error: 'período is already abierto' };
    }

    // RF-32: the exact inverse of cierre's stamping UPDATE — scoped by the
    // cierre stamp AND estado = 'conciliado'. Manual resolver marks carry no
    // stamp, so the WHERE clause can never un-resolve them.
    const { rowCount: vouchersReabiertos } = await client.query(
      `UPDATE vouchers_canonical
          SET estado = 'pendiente', periodo_cierre_id = NULL
        WHERE periodo_cierre_id = $1 AND estado = 'conciliado'`,
      [periodoId],
    );

    // RF-33(1): empty the frozen snapshot (append-only doctrine's single,
    // audited exception — see cierre-de-mes delta). It regenerates fully at
    // the next cierre.
    const { rowCount: resultadosEliminados } = await client.query(
      'DELETE FROM periodo_resultados WHERE periodo_id = $1',
      [periodoId],
    );

    // RF-33(2): reset exactly the columns cierre set (mirror image of its
    // final UPDATE, which also snapshots tolerancia_ars).
    const { rows: reopenedRows } = await client.query<{
      id: string;
      tenant_id: string;
      mes: string;
      estado: 'abierto';
      tolerancia_ars: null;
      cerrado_at: null;
      cerrado_por: null;
    }>(
      `UPDATE periodos
          SET estado = 'abierto', tolerancia_ars = NULL, cerrado_at = NULL, cerrado_por = NULL
        WHERE id = $1
        RETURNING id, tenant_id, mes::text AS mes, estado, tolerancia_ars, cerrado_at::text AS cerrado_at, cerrado_por`,
      [periodoId],
    );

    // RF-34: audited INSIDE this transaction — rollback removes the audit
    // row too, so only committed reopens ever appear in audit_trail.
    await logAuditEvent(client, {
      tenantId: periodo.tenant_id,
      userId,
      action: 'reopen',
      entity: 'periodo',
      entityId: periodoId,
      details: { vouchers_reabiertos: vouchersReabiertos ?? 0, resultados_eliminados: resultadosEliminados ?? 0 },
    });

    await client.query('COMMIT');

    return {
      periodo: reopenedRows[0],
      counts: {
        vouchers_reabiertos: vouchersReabiertos ?? 0,
        resultados_eliminados: resultadosEliminados ?? 0,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
