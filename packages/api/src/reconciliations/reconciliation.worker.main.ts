/**
 * reconciliation.worker.main.ts — standalone BullMQ worker process.
 *
 * Deliberately separate from the HTTP server (main.ts): per
 * architecture.md, ingestion runs in a background job so uploads don't
 * block the request/response cycle. Run alongside the API:
 *
 *   DATABASE_URL=... REDIS_HOST=... npx ts-node src/reconciliations/reconciliation.worker.main.ts
 */
import { getPgPool } from '../db/pg-pool';
import { createReconciliationWorker } from './reconciliation.worker';

function main() {
  // Shared pool-creation path with the HTTP process (getPgPool also reads
  // DATABASE_URL and throws if it's unset) — see packages/api/src/db/pg-pool.ts.
  const pool = getPgPool();
  const worker = createReconciliationWorker(pool);

  worker.on('completed', (job) => {
    // eslint-disable-next-line no-console
    console.log(`[reconciliation.worker] job ${job.id} completed`, job.returnvalue);
  });
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[reconciliation.worker] job ${job?.id} failed`, err);
  });

  // eslint-disable-next-line no-console
  console.log('[reconciliation.worker] listening on queue "reconciliations"');
}

main();
