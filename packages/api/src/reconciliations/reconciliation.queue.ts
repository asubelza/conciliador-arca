/**
 * reconciliation.queue.ts — T05 (RF-03/RF-04): the BullMQ queue the upload
 * controller enqueues into and the worker (reconciliation.worker.ts)
 * consumes from. `job_id` returned to the client IS the BullMQ job id
 * (we pass it explicitly as `jobId` when adding the job), so the status
 * endpoint (T06) can look it up directly via `queue.getJob(jobId)` with no
 * extra id-mapping table.
 */
import { Queue } from 'bullmq';
import type { AllowedExtension } from './upload-validation';

export const RECONCILIATION_QUEUE_NAME = 'reconciliations';

export interface ReconciliationJobData {
  tenantId: string;
  arca: { filePath: string; originalName: string; extension: AllowedExtension };
  contabilidad: { filePath: string; originalName: string; extension: AllowedExtension };
}

export interface ReconciliationJobResult {
  arca_rows: number;
  contabilidad_rows: number;
}

export function getRedisConnectionOptions() {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  };
}

let queue: Queue<ReconciliationJobData, ReconciliationJobResult> | undefined;

export function getReconciliationQueue(): Queue<ReconciliationJobData, ReconciliationJobResult> {
  if (!queue) {
    queue = new Queue<ReconciliationJobData, ReconciliationJobResult>(RECONCILIATION_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
    });
  }
  return queue;
}

/** Test-only escape hatch: force a fresh Queue instance on the next call. */
export function resetReconciliationQueueForTests(): void {
  queue = undefined;
}
