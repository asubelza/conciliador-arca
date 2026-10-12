/**
 * reconciliation.worker.ts — T05 (RF-03) + T10 (RF-09): the BullMQ worker
 * that stages an upload's two files into `vouchers_staging`, then runs the
 * full classification pipeline (T07 adapters -> T08 normalizer -> T09
 * dedupe/match -> T10 classify/sort) and persists the outcome into
 * `reconciliation_results` — the "staging -> results, automatically after
 * every upload" connection the estado_dev doc calls T10b.
 *
 * `processReconciliationJob` is exported as a plain async function
 * (independent of BullMQ) so tests can call it directly without needing a
 * live queue/worker pair — `createReconciliationWorker` is the thin BullMQ
 * adapter used by the real process (see reconciliation.worker.main.ts).
 *
 * Staging + classification + persistence all run inside a single
 * transaction: if any stage fails (corrupt file, unreadable row), the
 * whole job rolls back — a job either lands completely (staged rows +
 * reconciliation_results) or not at all.
 */
import type { Pool, PoolClient } from 'pg';
import { Worker } from 'bullmq';
import { promises as fs } from 'fs';
import { streamRowsFromFile } from './file-row-stream';
import { writeRowsToStaging } from './staging-writer';
import { classifyVouchers, normalizeStagedRows } from './classification-engine';
import { writeResultsToDb } from './results-writer';
import { logAuditEvent } from './audit-logger';
import { upsertVouchersCanonical } from './vouchers-canonical-writer';
import type { RawRow } from './file-row-stream';
import {
  RECONCILIATION_QUEUE_NAME,
  ReconciliationJobData,
  ReconciliationJobResult,
  getRedisConnectionOptions,
} from './reconciliation.queue';

async function cleanupTempFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (p) => {
      try {
        await fs.unlink(p);
      } catch (err) {
        // Not fatal to job completion (the file may already be gone or
        // never created), but a persistent failure here means disk
        // accumulates orphaned uploads silently, so log it rather than
        // swallowing it outright.
        // eslint-disable-next-line no-console
        console.error(`[reconciliation.worker] failed to clean up temp file "${p}"`, err);
      }
    }),
  );
}

async function readStagedRows(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  fileSource: 'arca' | 'contabilidad',
): Promise<RawRow[]> {
  const { rows } = await client.query<{ raw_data: RawRow }>(
    'SELECT raw_data FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 AND file_source = $3',
    [tenantId, jobId, fileSource],
  );
  return rows.map((r) => r.raw_data);
}

export async function processReconciliationJob(
  pool: Pool,
  jobId: string,
  data: ReconciliationJobData,
  options: { cleanupOnFailure?: boolean } = {},
): Promise<ReconciliationJobResult> {
  // Default true: a direct, non-BullMQ caller (e.g. reconciliation.worker.test.ts)
  // gets exactly one attempt, so cleaning up on failure there is correct —
  // nothing will ever retry it. `createReconciliationWorker` below is the
  // only caller that overrides this, and only for a non-final retry
  // attempt (see finding #8: adding `attempts`/`backoff` to the BullMQ job
  // options means a failed attempt may be retried, and a retry needs the
  // temp files to still be on disk — deleting them after every failed
  // attempt would make every retry fail with ENOENT, silently defeating
  // the whole point of retrying).
  const { cleanupOnFailure = true } = options;
  const client = await pool.connect();
  let succeeded = false;
  try {
    await client.query('BEGIN');

    const arcaStaged = await writeRowsToStaging(
      client,
      data.tenantId,
      jobId,
      'arca',
      streamRowsFromFile(data.arca.filePath, data.arca.extension),
    );
    const contabilidadStaged = await writeRowsToStaging(
      client,
      data.tenantId,
      jobId,
      'contabilidad',
      streamRowsFromFile(data.contabilidad.filePath, data.contabilidad.extension, data.contabilidadSourceSystem),
    );

    // Read back within the same transaction (COPY's writes are visible to
    // later statements on the same connection before COMMIT) rather than
    // reusing the in-memory rows from the parsers above — this proves the
    // staging round-trip actually works, not just that the parser did.
    const arcaRawRows = await readStagedRows(client, data.tenantId, jobId, 'arca');
    const contabilidadRawRows = await readStagedRows(client, data.tenantId, jobId, 'contabilidad');

    // T12 (RF-11): logged inside the same transaction as the staging writes
    // it describes, so a job that ultimately rolls back never leaves a
    // dangling 'upload' audit row behind — the log and the data it
    // references land, or roll back, together.
    await logAuditEvent(client, {
      tenantId: data.tenantId,
      action: 'upload',
      entity: 'reconciliation_job',
      entityId: jobId,
      details: {
        rows: arcaStaged.rowCount + contabilidadStaged.rowCount,
        arca_rows: arcaStaged.rowCount,
        contabilidad_rows: contabilidadStaged.rowCount,
      },
    });

    const { arcaOk, contabilidadOk, arcaErrors, contabilidadErrors } = normalizeStagedRows(
      arcaRawRows,
      contabilidadRawRows,
      data.contabilidadSourceSystem,
    );
    const { results, counts } = classifyVouchers(arcaOk, contabilidadOk, arcaErrors, contabilidadErrors);
    await writeResultsToDb(client, data.tenantId, jobId, results);

    // T22 (RF-15, conciliacion-periodica): upsert the successfully
    // normalized vouchers into the persistent vouchers_canonical stock —
    // only when this job belongs to a período (see ReconciliationJobData's
    // module doc: periodoId is optional on the interface only because a
    // handful of pre-conciliacion-periodica tests construct job data
    // without it; every real upload through the controller always sets it,
    // RF-13 requires periodo_id on every upload now).
    let matchAuditDetails: Record<string, unknown> = { ...counts };
    if (data.periodoId) {
      const upsertResult = await upsertVouchersCanonical(client, data.tenantId, data.periodoId, [
        ...arcaOk,
        ...contabilidadOk,
      ]);
      matchAuditDetails = {
        ...matchAuditDetails,
        vouchers_canonical_upserted: upsertResult.upserted,
        vouchers_canonical_skipped_conciliado: upsertResult.skippedConciliado,
      };
    }

    await logAuditEvent(client, {
      tenantId: data.tenantId,
      action: 'match',
      entity: 'reconciliation_job',
      entityId: jobId,
      details: matchAuditDetails,
    });

    await client.query('COMMIT');
    succeeded = true;

    return {
      arca_rows: arcaStaged.rowCount,
      contabilidad_rows: contabilidadStaged.rowCount,
      ...counts,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    if (succeeded || cleanupOnFailure) {
      await cleanupTempFiles([data.arca.filePath, data.contabilidad.filePath]);
    }
  }
}

export function createReconciliationWorker(pool: Pool): Worker<ReconciliationJobData, ReconciliationJobResult> {
  return new Worker<ReconciliationJobData, ReconciliationJobResult>(
    RECONCILIATION_QUEUE_NAME,
    (job) => {
      const totalAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= totalAttempts;
      return processReconciliationJob(pool, job.id as string, job.data, {
        cleanupOnFailure: isFinalAttempt,
      });
    },
    { connection: getRedisConnectionOptions() },
  );
}
