/**
 * comprobante-arca-manual.ts — 2026-10-12: "manual ARCA voucher creation".
 * A contador sometimes finds a comprobante directly in AFIP's own portal
 * that was never captured by any uploaded ARCA file; this registers it by
 * hand so it enters the normal matching engine as a regular pendiente ARCA
 * voucher — same single-transaction + typed-failure pattern as
 * periodo-reapertura.ts/periodo-eliminacion.ts.
 *
 * Persistence is delegated entirely to upsertVouchersCanonical
 * (vouchers-canonical-writer.ts) — the SAME writer every uploaded-file job
 * uses — so a manual entry is indistinguishable from an uploaded one once
 * it lands in `vouchers_canonical` (estado forced to 'pendiente' on insert,
 * upserted on the same composite key). The one real decision this module
 * makes is `periodo_alta_id`: the tenant's currently `abierto` período if
 * it has one, otherwise NULL (vouchers-canonical-writer.ts's periodoId
 * param was widened to `string | null` for exactly this case).
 *
 * Conflict detection reuses the writer's own return value
 * (`skippedConciliado`) rather than a separate pre-check query — the writer
 * already silently no-ops an upsert against an existing `conciliado` row
 * (RF-15's third scenario), so a non-zero `skippedConciliado` here means
 * "a conciliado voucher with this exact composite key already exists",
 * which this module surfaces as a 409 instead of a false-success.
 */
import type { Pool } from 'pg';
import type { CanonicalVoucher } from 'shared-types';
import { upsertVouchersCanonical } from '../reconciliations/vouchers-canonical-writer';
import { logAuditEvent } from '../reconciliations/audit-logger';
import type { ComprobanteArcaManualRequestBody } from './comprobante-arca-manual-validation';

export type ComprobanteArcaManualFailure =
  | { code: 'TENANT_NOT_FOUND'; status: 404; error: string }
  | { code: 'CONCILIADO_CONFLICT'; status: 409; error: string };

/** Mirrors the column selection pendientes-historico.ts/periodo-matching-engine.ts already use for a vouchers_canonical row. */
export interface ComprobanteArcaManualResult {
  id: string;
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  importe_total: number | null;
  iva: number | null;
  fecha: string | null;
  file_source: 'arca';
  estado: 'pendiente' | 'conciliado';
  periodo_alta_id: string | null;
}

export async function createComprobanteArcaManual(
  pool: Pool,
  tenantId: string,
  input: ComprobanteArcaManualRequestBody,
  userId: string,
): Promise<ComprobanteArcaManualResult | ComprobanteArcaManualFailure> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: tenantRows } = await client.query<{ id: string }>('SELECT id FROM tenants WHERE id = $1', [tenantId]);
    if (tenantRows.length === 0) {
      await client.query('ROLLBACK');
      return { code: 'TENANT_NOT_FOUND', status: 404, error: 'tenant not found' };
    }

    // "the tenant has a período with estado='abierto'" — most recent month
    // first, same ORDER BY direction as PeriodosController.list(); a tenant
    // should only ever have at most one abierto período in practice, but
    // LIMIT 1 keeps this well-defined even if that invariant is ever broken.
    const { rows: periodoRows } = await client.query<{ id: string }>(
      `SELECT id FROM periodos WHERE tenant_id = $1 AND estado = 'abierto' ORDER BY mes DESC LIMIT 1`,
      [tenantId],
    );
    const periodoAltaId = periodoRows[0]?.id ?? null;

    const voucher: CanonicalVoucher = {
      cuit_emisor: input.cuit_emisor,
      tipo_cbte: input.tipo_cbte,
      punto_venta: input.punto_venta,
      numero: input.numero,
      fecha_emision: input.fecha_emision,
      importe_total_ars: input.importe_total_ars,
      iva: input.iva,
      moneda: 'ARS',
      file_source: 'arca',
      // No real uploaded file row sits behind a manual entry — this just
      // echoes the submitted fields in the same jsonb shape column-adapters.ts'
      // adapters produce (RawRow), tagged so it's identifiable later.
      source_row: {
        cuit_emisor: input.cuit_emisor,
        tipo_cbte: input.tipo_cbte,
        punto_venta: input.punto_venta,
        numero: input.numero,
        fecha_emision: input.fecha_emision,
        importe_total_ars: input.importe_total_ars,
        iva: input.iva,
        origen: 'manual',
      },
    };

    const writeResult = await upsertVouchersCanonical(client, tenantId, periodoAltaId, [voucher]);
    if (writeResult.skippedConciliado > 0) {
      await client.query('ROLLBACK');
      return {
        code: 'CONCILIADO_CONFLICT',
        status: 409,
        error: 'ya existe un comprobante ARCA conciliado con esa clave',
      };
    }

    const { rows } = await client.query<ComprobanteArcaManualResult>(
      `SELECT id, cuit_emisor, tipo_cbte, punto_venta, numero,
              importe_total::float AS importe_total, iva, fecha::text AS fecha,
              file_source, estado, periodo_alta_id
         FROM vouchers_canonical
        WHERE tenant_id = $1 AND file_source = 'arca' AND cuit_emisor = $2
          AND tipo_cbte = $3 AND punto_venta = $4 AND numero = $5`,
      [tenantId, voucher.cuit_emisor, voucher.tipo_cbte, voucher.punto_venta, voucher.numero],
    );

    await logAuditEvent(client, {
      tenantId,
      userId,
      action: 'comprobante_arca_manual_creado',
      entity: 'vouchers_canonical',
      entityId: rows[0].id,
      details: {
        cuit_emisor: voucher.cuit_emisor,
        tipo_cbte: voucher.tipo_cbte,
        punto_venta: voucher.punto_venta,
        numero: voucher.numero,
        periodo_alta_id: periodoAltaId,
      },
    });

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
