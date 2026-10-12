/**
 * reconciliation.queue.ts — T05 (RF-03/RF-04): the BullMQ queue the upload
 * controller enqueues into and the worker (reconciliation.worker.ts)
 * consumes from. `job_id` returned to the client IS the BullMQ job id
 * (we pass it explicitly as `jobId` when adding the job), so the status
 * endpoint (T06) can look it up directly via `queue.getJob(jobId)` with no
 * extra id-mapping table.
 */
import { Queue } from 'bullmq';
import type { AllowedExtension, ContabilidadSourceSystem } from './upload-validation';

export const RECONCILIATION_QUEUE_NAME = 'reconciliations';

export interface ReconciliationJobData {
  tenantId: string;
  contabilidadSourceSystem: ContabilidadSourceSystem;
  arca: { filePath: string; originalName: string; extension: AllowedExtension };
  contabilidad: { filePath: string; originalName: string; extension: AllowedExtension };
  /**
   * T19 (RF-13, conciliacion-periodica): the período this upload belongs
   * to. The controller always sets this now (periodo_id is a required
   * upload field, validated + checked open against the DB before the job is
   * enqueued — see reconciliations.controller.ts + periodo-upload-guard.ts).
   * Optional here (not on the DB/worker side yet) because
   * processReconciliationJob doesn't persist or use it — that lands with
   * Phase 2's T22 upsert-into-vouchers_canonical work, which is what
   * actually needs periodo_alta_id. Keeping it optional on this interface
   * avoids implying the worker enforces something it doesn't do yet.
   */
  periodoId?: string;
}

export interface ReconciliationJobResult {
  arca_rows: number;
  contabilidad_rows: number;
  matched: number;
  'unmatched-arca': number;
  'unmatched-contabilidad': number;
  duplicates: number;
  errors: number;
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
