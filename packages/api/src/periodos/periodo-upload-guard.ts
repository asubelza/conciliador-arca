/**
 * periodo-upload-guard.ts — T19 (RF-13): DB-backed check that a
 * `periodo_id` supplied to POST /api/reconciliations both exists (scoped to
 * the uploading tenant) and is `abierto`, run once upload-validation.ts's
 * pure checks (files/tenant_id/source_system/periodo_id format) have
 * already passed.
 *
 * Kept as its own module — separate from upload-validation.ts, whose other
 * checks are all pure sync functions — because this one needs a Pool, and
 * separate from periodos-validation.ts, which is about the /api/periodos
 * endpoints themselves, not the reconciliations upload path that merely
 * references a período by id.
 *
 * Deliberately returns "not found" (not 404, and not distinguishing
 * "unknown id" from "belongs to another tenant") for both cases: scoping the
 * lookup by `tenant_id` in the same query means a caller can't use this
 * upload endpoint to probe whether a period_id exists under a different
 * tenant.
 */
import type { Pool } from 'pg';

export interface PeriodoUploadFailure {
  status: 400;
  error: string;
}

export async function assertPeriodoOpenForUpload(
  pool: Pool,
  tenantId: string,
  periodoId: string,
): Promise<PeriodoUploadFailure | null> {
  const { rows } = await pool.query<{ estado: string }>(
    'SELECT estado FROM periodos WHERE id = $1 AND tenant_id = $2',
    [periodoId, tenantId],
  );

  if (rows.length === 0) {
    return {
      status: 400,
      error: 'periodo_id does not reference an existing período for this tenant',
    };
  }

  if (rows[0].estado === 'cerrado') {
    return {
      status: 400,
      error: 'período is closed — uploads are only accepted while abierto',
    };
  }

  return null;
}
