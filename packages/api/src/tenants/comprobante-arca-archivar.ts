/**
 * comprobante-arca-archivar.ts — 2026-10-12 (Histórico filters +
 * "Archivar", client dashboard feedback): the contador can mark a pendiente
 * ARCA voucher from "Histórico de Pendientes en ARCA"
 * (PendientesHistoricoViewer.tsx) as "no longer relevant" — not matched,
 * but also not a real `conciliado` resolution (resolverPendienteArca's
 * existing action already covers that other case). `estado = 'archivado'`
 * (024_alter_vouchers_canonical_estado_add_archivado.sql) is a second
 * terminal state, excluded from all future matching exactly like
 * `conciliado` (see periodo-matching-engine.ts / vouchers-canonical-writer.ts).
 *
 * Two entry points, one single-voucher action reused by both:
 *
 *   - `archivarComprobanteArca`: the single-voucher endpoint
 *     (POST /api/tenants/:id/comprobantes/:voucherId/archivar). Same
 *     validation shape as periodos.controller.ts's resolverPendienteArca —
 *     a tenant-scoped lookup collapses "voucher doesn't exist" and "voucher
 *     belongs to another tenant" into the same 404 (never distinguished,
 *     same posture as that endpoint).
 *
 *   - `archivarComprobantesArcaLote`: the bulk endpoint
 *     (POST /api/tenants/:id/comprobantes/archivar-lote). RNF-07 ("nunca
 *     ocultar" — see pendientes-historico.ts's own module doc and its
 *     excluidos_previos_a_alta precedent) rules out an all-or-nothing
 *     transaction here: a batch mixing valid and invalid ids must archive
 *     every valid one and report exactly why each invalid one was skipped,
 *     never silently roll back the whole call over one bad id. Each id is
 *     looked up WITHOUT the tenant filter first so "not_found" (no such
 *     voucher at all) and "wrong_tenant" (exists, but for another tenant)
 *     are reported as the two distinct reasons the endpoint contract calls
 *     for — the single-voucher endpoint above deliberately does NOT make
 *     this distinction (matching resolverPendienteArca's own precedent),
 *     but the bulk endpoint's own contract explicitly lists both as
 *     separate skip reasons.
 */
import type { Pool, PoolClient } from 'pg';
import { logAuditEvent } from '../reconciliations/audit-logger';

export type ArchivarComprobanteFailure =
  | { code: 'TENANT_NOT_FOUND'; status: 404; error: string }
  | { code: 'VOUCHER_NOT_FOUND'; status: 404; error: string }
  | { code: 'WRONG_FILE_SOURCE'; status: 400; error: string }
  | { code: 'ALREADY_RESOLVED'; status: 409; error: string };

export interface ArchivarComprobanteResult {
  id: string;
  estado: 'archivado';
}

async function fetchTenantExists(client: PoolClient, tenantId: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
  return rows.length > 0;
}

export async function archivarComprobanteArca(
  pool: Pool,
  tenantId: string,
  voucherId: string,
  nota: string | null,
  userId: string,
): Promise<ArchivarComprobanteResult | ArchivarComprobanteFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!(await fetchTenantExists(client, tenantId))) {
      await client.query('ROLLBACK');
      return { code: 'TENANT_NOT_FOUND', status: 404, error: 'tenant not found' };
    }

    const { rows: voucherRows } = await client.query<{ id: string; file_source: string; estado: string }>(
      'SELECT id, file_source, estado FROM vouchers_canonical WHERE tenant_id = $1 AND id = $2',
      [tenantId, voucherId],
    );
    if (voucherRows.length === 0) {
      await client.query('ROLLBACK');
      return {
        code: 'VOUCHER_NOT_FOUND',
        status: 404,
        error: 'voucher_id must reference an existing voucher for this tenant',
      };
    }

    if (voucherRows[0].file_source !== 'arca') {
      await client.query('ROLLBACK');
      return {
        code: 'WRONG_FILE_SOURCE',
        status: 400,
        error: 'voucher_id must be an ARCA-side voucher — only ARCA pendientes can be archived',
      };
    }

    const estadoActual = voucherRows[0].estado;
    if (estadoActual === 'conciliado' || estadoActual === 'archivado') {
      await client.query('ROLLBACK');
      return { code: 'ALREADY_RESOLVED', status: 409, error: `this voucher is already ${estadoActual}` };
    }

    // Atomic guard against the race the earlier SELECT (line 71-74) can't
    // close by itself: a concurrent writer (an upload's upsert, a período
    // closing/matching this same voucher to 'conciliado') could change
    // `estado` between that read and this write. Re-stating the condition
    // in the UPDATE's WHERE — same idiom vouchers-canonical-writer.ts
    // already uses for this exact problem — means a 0-row result here can
    // only happen because something else won the race, not because of a
    // bug; that's reported as the same 409 instead of a silent overwrite.
    const { rows: updatedRows } = await client.query<{ id: string; estado: 'archivado' }>(
      `UPDATE vouchers_canonical SET estado = 'archivado'
       WHERE id = $1 AND estado NOT IN ('conciliado', 'archivado')
       RETURNING id, estado`,
      [voucherId],
    );
    if (updatedRows.length === 0) {
      await client.query('ROLLBACK');
      return { code: 'ALREADY_RESOLVED', status: 409, error: 'this voucher was resolved by a concurrent operation' };
    }

    await logAuditEvent(client, {
      tenantId,
      userId,
      action: 'comprobante_arca_archivado',
      entity: 'vouchers_canonical',
      entityId: voucherId,
      details: { nota },
    });

    await client.query('COMMIT');
    return updatedRows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type DesarchivarComprobanteFailure =
  | { code: 'TENANT_NOT_FOUND'; status: 404; error: string }
  | { code: 'VOUCHER_NOT_FOUND'; status: 404; error: string }
  | { code: 'NOT_ARCHIVED'; status: 409; error: string };

export interface DesarchivarComprobanteResult {
  id: string;
  estado: 'pendiente';
}

/**
 * 2026-10-12 ("Match manual" para filas `no_existe_en_arca`): la contraparte
 * exacta de `archivarComprobanteArca` arriba — usada por MatchManualModal.tsx's
 * tab "Buscar en archivados", cuando el contador encuentra ahí el comprobante
 * ARCA que en realidad SÍ corresponde a un comprobante del sistema contable
 * sin match (es decir, se archivó por error, o simplemente nadie lo había
 * emparejado todavía). Pone `estado` de nuevo en 'pendiente', así vuelve a
 * participar en matchPeriodo — que excluye 'archivado' igual que 'conciliado'
 * (ver periodo-matching-engine.ts's `matchPeriodo`). El caller (el modal) SIEMPRE
 * llama a este endpoint ANTES de POST /api/periodos/:id/coincidencias: una
 * confirmación contra un voucher todavía 'archivado' no tomaría en el próximo
 * report read, por la misma exclusión.
 *
 * Mismo guard atómico que `archivarComprobanteArca` (ver su comentario arriba,
 * líneas 99-106): la condición se repite en el WHERE del UPDATE, así que un
 * resultado de 0 filas solo puede significar que una operación concurrente ya
 * resolvió este voucher entre el SELECT y este UPDATE — se reporta como el
 * mismo 409, nunca como un overwrite silencioso.
 */
export async function desarchivarComprobanteArca(
  pool: Pool,
  tenantId: string,
  voucherId: string,
  userId: string,
): Promise<DesarchivarComprobanteResult | DesarchivarComprobanteFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!(await fetchTenantExists(client, tenantId))) {
      await client.query('ROLLBACK');
      return { code: 'TENANT_NOT_FOUND', status: 404, error: 'tenant not found' };
    }

    const { rows: voucherRows } = await client.query<{ id: string; estado: string }>(
      'SELECT id, estado FROM vouchers_canonical WHERE tenant_id = $1 AND id = $2',
      [tenantId, voucherId],
    );
    if (voucherRows.length === 0) {
      await client.query('ROLLBACK');
      return {
        code: 'VOUCHER_NOT_FOUND',
        status: 404,
        error: 'voucher_id must reference an existing voucher for this tenant',
      };
    }

    const estadoActual = voucherRows[0].estado;
    if (estadoActual !== 'archivado') {
      await client.query('ROLLBACK');
      return { code: 'NOT_ARCHIVED', status: 409, error: `this voucher is ${estadoActual}, not archivado` };
    }

    const { rows: updatedRows } = await client.query<{ id: string; estado: 'pendiente' }>(
      `UPDATE vouchers_canonical SET estado = 'pendiente'
       WHERE id = $1 AND estado = 'archivado'
       RETURNING id, estado`,
      [voucherId],
    );
    if (updatedRows.length === 0) {
      await client.query('ROLLBACK');
      return { code: 'NOT_ARCHIVED', status: 409, error: 'this voucher was resolved by a concurrent operation' };
    }

    await logAuditEvent(client, {
      tenantId,
      userId,
      action: 'comprobante_arca_desarchivado',
      entity: 'vouchers_canonical',
      entityId: voucherId,
      details: null,
    });

    await client.query('COMMIT');
    return updatedRows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type ArchivarLoteSkipReason = 'not_found' | 'wrong_tenant' | 'wrong_file_source' | 'already_conciliado' | 'already_archivado';

export interface ArchivarLoteItemResult {
  voucher_id: string;
  status: 'archived' | 'skipped';
  reason?: ArchivarLoteSkipReason;
}

export interface ArchivarComprobantesLoteResult {
  results: ArchivarLoteItemResult[];
}

export type ArchivarComprobantesLoteFailure = { code: 'TENANT_NOT_FOUND'; status: 404; error: string };

/**
 * Looks up `voucherId` WITHOUT a tenant filter — see this module's own doc
 * for why "not_found" and "wrong_tenant" must be told apart here, unlike
 * the single-voucher endpoint above.
 */
async function archiveOneForLote(
  pool: Pool,
  tenantId: string,
  voucherId: string,
  nota: string | null,
  userId: string,
): Promise<ArchivarLoteItemResult> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string; tenant_id: string; file_source: string; estado: string }>(
      'SELECT id, tenant_id, file_source, estado FROM vouchers_canonical WHERE id = $1',
      [voucherId],
    );
    if (rows.length === 0) {
      return { voucher_id: voucherId, status: 'skipped', reason: 'not_found' };
    }
    const voucher = rows[0];
    if (voucher.tenant_id !== tenantId) {
      return { voucher_id: voucherId, status: 'skipped', reason: 'wrong_tenant' };
    }
    if (voucher.file_source !== 'arca') {
      return { voucher_id: voucherId, status: 'skipped', reason: 'wrong_file_source' };
    }
    if (voucher.estado === 'conciliado') {
      return { voucher_id: voucherId, status: 'skipped', reason: 'already_conciliado' };
    }
    if (voucher.estado === 'archivado') {
      return { voucher_id: voucherId, status: 'skipped', reason: 'already_archivado' };
    }

    await client.query('BEGIN');
    try {
      // Same atomic re-check as archivarComprobanteArca above — the checks
      // at lines 165-170 read `estado` before BEGIN, so a concurrent writer
      // (another archivar-lote call for the same id, or a reconciliation
      // run) can still resolve this voucher before this UPDATE commits.
      const { rows: updatedRows } = await client.query<{ estado: string }>(
        `UPDATE vouchers_canonical SET estado = 'archivado'
         WHERE id = $1 AND estado NOT IN ('conciliado', 'archivado')
         RETURNING estado`,
        [voucherId],
      );
      if (updatedRows.length === 0) {
        await client.query('ROLLBACK');
        const { rows: currentRows } = await pool.query<{ estado: string }>(
          'SELECT estado FROM vouchers_canonical WHERE id = $1',
          [voucherId],
        );
        const reason: ArchivarLoteSkipReason = currentRows[0]?.estado === 'conciliado' ? 'already_conciliado' : 'already_archivado';
        return { voucher_id: voucherId, status: 'skipped', reason };
      }
      await logAuditEvent(client, {
        tenantId,
        userId,
        action: 'comprobante_arca_archivado',
        entity: 'vouchers_canonical',
        entityId: voucherId,
        details: { nota, lote: true },
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }

    return { voucher_id: voucherId, status: 'archived' };
  } finally {
    client.release();
  }
}

/**
 * Processes each id independently (its own connection + transaction) so one
 * bad id never rolls back the others — see this module's own doc (RNF-07).
 * Sequential, not parallel: a bulk archive is an infrequent, user-triggered
 * admin action on a small selection, not a hot path, so the simplicity of
 * one-at-a-time processing (and a straightforward, order-preserving results
 * array) outweighs any benefit from concurrency here.
 */
export async function archivarComprobantesArcaLote(
  pool: Pool,
  tenantId: string,
  voucherIds: string[],
  nota: string | null,
  userId: string,
): Promise<ArchivarComprobantesLoteResult | ArchivarComprobantesLoteFailure> {
  const { rows: tenantRows } = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
  if (tenantRows.length === 0) {
    return { code: 'TENANT_NOT_FOUND', status: 404, error: 'tenant not found' };
  }

  const results: ArchivarLoteItemResult[] = [];
  for (const voucherId of voucherIds) {
    results.push(await archiveOneForLote(pool, tenantId, voucherId, nota, userId));
  }

  return { results };
}
