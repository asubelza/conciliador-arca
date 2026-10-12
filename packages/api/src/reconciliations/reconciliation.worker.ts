/**
 * reconciliation.worker.ts — T05 (RF-03): the BullMQ worker that actually
 * stages an upload's two files into `vouchers_staging`.
 *
 * `processReconciliationJob` is exported as a plain async function
 * (independent of BullMQ) so tests can call it directly without needing a
 * live queue/worker pair — `createReconciliationWorker` is the thin BullMQ
 * adapter used by the real process (see reconciliation.worker.main.ts).
 *
 * Both files are staged inside a single transaction: if either file's
 * COPY aborts (corrupt row, unreadable file), the whole job rolls back —
 * a stronger guarantee than RF-03's literal "that file's rows roll back"
 * scenario, chosen so a job never leaves half its data staged.
 */
import type { Pool } from 'pg';
import { Worker } from 'bullmq';
import { promises as fs } from 'fs';
import { streamRowsFromFile } from './file-row-stream';
import { writeRowsToStaging } from './staging-writer';
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

    const arcaResult = await writeRowsToStaging(
      client,
      data.tenantId,
      jobId,
      'arca',
      streamRowsFromFile(data.arca.filePath, data.arca.extension),
    );
    const contabilidadResult = await writeRowsToStaging(
      client,
      data.tenantId,
      jobId,
      'contabilidad',
      streamRowsFromFile(data.contabilidad.filePath, data.contabilidad.extension),
    );

    await client.query('COMMIT');
    succeeded = true;

    return {
      arca_rows: arcaResult.rowCount,
      contabilidad_rows: contabilidadResult.rowCount,
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
