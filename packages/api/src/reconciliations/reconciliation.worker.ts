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
      } catch {
        // Already gone or never created — not fatal to job completion.
      }
    }),
  );
}

export async function processReconciliationJob(
  pool: Pool,
  jobId: string,
  data: ReconciliationJobData,
): Promise<ReconciliationJobResult> {
  const client = await pool.connect();
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

    return {
      arca_rows: arcaResult.rowCount,
      contabilidad_rows: contabilidadResult.rowCount,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await cleanupTempFiles([data.arca.filePath, data.contabilidad.filePath]);
  }
}

export function createReconciliationWorker(pool: Pool): Worker<ReconciliationJobData, ReconciliationJobResult> {
  return new Worker<ReconciliationJobData, ReconciliationJobResult>(
    RECONCILIATION_QUEUE_NAME,
    (job) => processReconciliationJob(pool, job.id as string, job.data),
    { connection: getRedisConnectionOptions() },
  );
}
