/**
 * job-status.ts — T06 (RF-04): maps a BullMQ job's state to the
 * `{ status, counts?, detail? }` shape from voucher-ingestion.spec.md.
 *
 * Kept as a pure function (given a state string + the job's returnvalue/
 * failedReason) so the state-mapping decision is unit-testable without a
 * live queue — reconciliations.controller.ts supplies the real BullMQ Job.
 */
import type { ReconciliationJobResult } from './reconciliation.queue';

export type ReconciliationStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface StatusResponse {
  status: ReconciliationStatus;
  counts?: { arca_rows: number; contabilidad_rows: number };
  detail?: string;
}

/**
 * The subset of a BullMQ Job this module needs — kept narrow (rather than
 * importing the real `Job` type) so unit tests can pass a plain object.
 */
export interface JobLike {
  returnvalue?: ReconciliationJobResult | null;
  failedReason?: string | null;
}

/**
 * BullMQ's `job.getState()` can return: 'completed' | 'failed' | 'delayed' |
 * 'active' | 'waiting' | 'waiting-children' | 'prioritized' | 'paused' |
 * 'unknown'. Everything that isn't actively running and hasn't reached a
 * terminal state maps to 'pending' (RF-04 only distinguishes 4 states).
 */
export function mapJobToStatusResponse(state: string, job: JobLike): StatusResponse {
  if (state === 'completed') {
    const result = job.returnvalue;
    if (result) {
      return {
        status: 'completed',
        counts: { arca_rows: result.arca_rows, contabilidad_rows: result.contabilidad_rows },
      };
    }
    return { status: 'completed' };
  }

  if (state === 'failed') {
    return { status: 'error', detail: job.failedReason ?? 'Unknown error' };
  }

  if (state === 'active') {
    return { status: 'processing' };
  }

  return { status: 'pending' };
}
