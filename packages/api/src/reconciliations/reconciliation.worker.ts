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
import { classifyStagedRows } from './classification-engine';
import { writeResultsToDb } from './results-writer';
import { logAuditEvent } from './audit-logger';
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
      } catch {
        // Already gone or never created — not fatal to job completion.
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
): Promise<ReconciliationJobResult> {
  const client = await pool.connect();
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
      streamRowsFromFile(data.contabilidad.filePath, data.contabilidad.extension),
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

    const { results, counts } = classifyStagedRows(arcaRawRows, contabilidadRawRows, data.contabilidadSourceSystem);
    await writeResultsToDb(client, data.tenantId, jobId, results);

    await logAuditEvent(client, {
      tenantId: data.tenantId,
      action: 'match',
      entity: 'reconciliation_job',
      entityId: jobId,
      details: { ...counts },
    });

    await client.query('COMMIT');

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
