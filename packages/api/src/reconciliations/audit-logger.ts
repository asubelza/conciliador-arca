/**
 * audit-logger.ts — T12 (RF-11): append-only event log writer for
 * `audit_trail` (006_init_audit_trail.sql, made append-only for `app_role`
 * by 007_enable_rls.sql's `REVOKE UPDATE, DELETE ON audit_trail FROM
 * app_role`).
 *
 * Kept as a thin insert-only helper — takes a `Pool | PoolClient` so callers
 * can log either as a standalone statement (the report-export endpoint,
 * against `getPgPool()`) or as part of an existing transaction (the worker,
 * against its `PoolClient`, so an audit row for a job that ultimately rolls
 * back never lands — see reconciliation.worker.ts's module doc).
 */
import type { Pool, PoolClient } from 'pg';

/**
 * RF-11's `audit_log` column doc lists this action set. audit_trail's real
 * column is called `action` (TEXT, no CHECK constraint — see
 * 006_init_audit_trail.sql), so this union is enforced at the TypeScript
 * layer only.
 */
// T27 (RF-20, conciliacion-periodica) adds 'close' — logged once per
// período when POST /api/periodos/:id/cerrar succeeds (periodo-cierre.ts).
// RF-04/RF-13 adds 'confirm_similarity'/'discard_similarity' — logged once
// per POST /api/periodos/:id/coincidencias decision (periodos.controller.ts).
// 2026-08-23 (client request, feature 2 de 3) adds
// 'resolve_pendiente_manual' — logged once per POST
// /api/periodos/:id/pendientes-arca-resolver, for an ARCA pendiente the
// contador knows will never have a real contabilidad pair (e.g. loaded in
// ARCA many months before the system was in use) and settles individually,
// without linking it to any sistema voucher.
// dashboard-principal RF-34 adds 'reopen' — logged INSIDE reabrirPeriodo's
// transaction (periodo-reapertura.ts), so a rollback removes the audit row
// and only committed reopens are audited. RF-36..RF-38 likewise add
// 'delete' for eliminarPeriodo's committed physical deletes.
// 2026-10-12 (manual ARCA voucher creation) adds
// 'comprobante_arca_manual_creado' — logged INSIDE
// createComprobanteArcaManual's transaction (tenants/comprobante-arca-manual.ts)
// per POST /api/tenants/:id/comprobantes-arca, so a rollback (e.g. the
// already-conciliado 409 case) removes the audit row too.
// 2026-10-12 (Histórico filters + "Archivar") adds
// 'comprobante_arca_archivado' — logged INSIDE
// archivarComprobanteArca's transaction (tenants/comprobante-arca-archivar.ts),
// once per voucher actually archived, for both POST
// /api/tenants/:id/comprobantes/:voucherId/archivar and POST
// /api/tenants/:id/comprobantes/archivar-lote (the lote endpoint logs one
// event per successfully-archived id, never for a skipped one).
// 2026-10-12 ("Match manual" para no_existe_en_arca) adds
// 'comprobante_arca_desarchivado' — logged INSIDE
// desarchivarComprobanteArca's transaction (tenants/comprobante-arca-archivar.ts),
// the exact inverse of 'comprobante_arca_archivado' above, for POST
// /api/tenants/:id/comprobantes/:voucherId/desarchivar.
export type AuditAction =
  | 'upload'
  | 'staging'
  | 'normalize'
  | 'match'
  | 'export'
  | 'user_mark'
  | 'feedback_read'
  | 'close'
  | 'reopen'
  | 'delete'
  | 'confirm_similarity'
  | 'discard_similarity'
  | 'resolve_pendiente_manual'
  | 'comprobante_arca_manual_creado'
  | 'comprobante_arca_archivado'
  | 'comprobante_arca_desarchivado';

export interface AuditEvent {
  tenantId: string;
  userId?: string | null;
  action: AuditAction;
  entity?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface AuditTrailRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function logAuditEvent(client: Pool | PoolClient, event: AuditEvent): Promise<AuditTrailRow> {
  const { rows } = await client.query<AuditTrailRow>(
    `INSERT INTO audit_trail (tenant_id, user_id, action, entity, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, user_id, action, entity, entity_id, details, created_at`,
    [
      event.tenantId,
      event.userId ?? null,
      event.action,
      event.entity ?? null,
      event.entityId ?? null,
      event.details ? JSON.stringify(event.details) : null,
    ],
  );
  return rows[0];
}
