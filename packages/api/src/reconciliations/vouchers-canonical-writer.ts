/**
 * vouchers-canonical-writer.ts — T22 (RF-15): upserts normalized
 * `CanonicalVoucher`s into `vouchers_canonical` by composite key
 * `(tenant_id, file_source, cuit_emisor, tipo_cbte, punto_venta, numero)`
 * (015_alter_vouchers_canonical_add_estado_periodo.sql's
 * `idx_vouchers_tenant_key_unique`), turning the table from an unused
 * artifact into the real persistent stock the 3-step matching engine
 * (`periodo-matching-engine.ts`) reads.
 *
 * ## periodo_alta_id: ARCA is immutable-once-set, contabilidad refreshes
 *
 * RF-15's scenarios are all ARCA-specific; the spec's general wording
 * ("Every job... MUST upsert... keyed by (tenant_id, file_source, ...)")
 * doesn't say what happens to `periodo_alta_id` for the contabilidad
 * (Sistema) side on a later re-upload. Two things need to both be true and
 * they pull in different directions if `periodo_alta_id` behaves the same
 * for both sides:
 *
 *   1. RF-19's antiguedad_meses needs an ARCA row's `periodo_alta_id` to
 *      mean "first ever loaded" — a pendiente ARCA voucher rolls forward
 *      across períodos without being re-uploaded, so this must never
 *      change once set.
 *   2. The matching pseudocode (architecture.md, "Algoritmo de Matching")
 *      needs "sistema_rows loaded in período P" to mean *this* período's
 *      own Sistema upload(s), not whichever período first happened to
 *      contain that composite key — a company's own accounting export is
 *      period-specific by nature.
 *
 * Resolution (originally a judgment call, flagged in
 * openspec/progress/PR-5.md — since confirmed correct with the client,
 * 2026-08-22, when asked directly about re-uploading the same ARCA range/
 * acumulado más adelante: "Es totalmente habitual volver a cargar archivos
 * con rangos de fechas ya cargados... Si ya existe: Simplemente omite la
 * inserción (o actualiza datos si hiciera falta), manteniendo su estado
 * original (PENDIENTE o CONCILIADO)."): `periodo_alta_id` is set once on
 * first insert (either side), then on every subsequent conflict only
 * refreshed for `file_source = 'contabilidad'` rows — ARCA rows keep
 * whatever período first inserted them, forever. `periodo-matching-
 * engine.ts`'s "sistema_rows for período P" query relies on this (`WHERE
 * file_source = 'contabilidad' AND periodo_alta_id = :periodoId`). Note
 * that `periodo_alta_id` is no longer what RF-19's antiguedad_meses
 * measures either (see periodo-matching-engine.ts's fetchViewedPeriodoYear
 * Month doc) — the client also confirmed antiguedad must track the
 * voucher's real fecha de emisión, not upload timing, so periodo_alta_id's
 * only remaining job is the corriente/histórico split.
 *
 * ## Immutability once conciliado (RF-15's third scenario)
 *
 * The `DO UPDATE ... WHERE vouchers_canonical.estado <> 'conciliado'`
 * clause means a conflicting upsert against an already-`conciliado` row is
 * silently a no-op — Postgres evaluates the WHERE per proposed row and
 * simply leaves it untouched (verified empirically: `RETURNING` produces
 * zero rows for a skipped conflict, which is exactly how this module tells
 * "upserted" apart from "skipped" without a second query). Nothing here
 * classifies that situation as a duplicate — that's
 * `periodo-matching-engine.ts`'s RF-17 check, which runs at *match* time,
 * not at upsert time.
 */
import type { PoolClient } from 'pg';
import type { CanonicalVoucher } from 'shared-types';

export interface UpsertVouchersResult {
  /** Rows actually inserted or updated (conflict resolved, not conciliado). */
  upserted: number;
  /** Rows left untouched because the existing row was already conciliado. */
  skippedConciliado: number;
}

/** DATE columns reject '' outright ("invalid input syntax for type date"); normalizeRow's parseFechaEmision returns '' for missing input. */
function toNullableDate(fechaEmision: string): string | null {
  return fechaEmision === '' ? null : fechaEmision;
}

export async function upsertVouchersCanonical(
  client: PoolClient,
  tenantId: string,
  // `string | null`: widened 2026-10-12 for manual ARCA voucher creation
  // (POST /api/tenants/:id/comprobantes-arca, tenants/comprobante-arca-manual.ts)
  // — a manually-registered comprobante has no período to stamp when the
  // tenant currently has no `estado = 'abierto'` período, and
  // `periodo_alta_id` is itself a nullable FK (015_alter_vouchers_canonical_
  // add_estado_periodo.sql), so passing NULL through here is correct, not a
  // workaround. Every pre-existing caller (reconciliation.worker.ts) always
  // has a real período id and is unaffected.
  periodoId: string | null,
  vouchers: CanonicalVoucher[],
): Promise<UpsertVouchersResult> {
  let upserted = 0;
  let skippedConciliado = 0;

  for (const voucher of vouchers) {
    const { rowCount } = await client.query(
      `INSERT INTO vouchers_canonical (
         tenant_id, fecha, tipo_cbte, cuit_emisor, punto_venta, numero,
         importe_total, iva, file_source, estado, periodo_alta_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendiente', $10)
       ON CONFLICT (tenant_id, file_source, cuit_emisor, tipo_cbte, punto_venta, numero)
       DO UPDATE SET
         fecha = EXCLUDED.fecha,
         importe_total = EXCLUDED.importe_total,
         iva = EXCLUDED.iva,
         periodo_alta_id = CASE
           WHEN EXCLUDED.file_source = 'contabilidad' THEN EXCLUDED.periodo_alta_id
           ELSE vouchers_canonical.periodo_alta_id
         END
       WHERE vouchers_canonical.estado <> 'conciliado'
       RETURNING id`,
      [
        tenantId,
        toNullableDate(voucher.fecha_emision),
        voucher.tipo_cbte,
        voucher.cuit_emisor,
        voucher.punto_venta,
        voucher.numero,
        voucher.importe_total_ars,
        voucher.iva,
        voucher.file_source,
        periodoId,
      ],
    );

    if (rowCount && rowCount > 0) {
      upserted += 1;
    } else {
      skippedConciliado += 1;
    }
  }

  return { upserted, skippedConciliado };
}
