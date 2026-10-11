/**
 * reconciliation.worker.main.ts — standalone BullMQ worker process.
 *
 * Deliberately separate from the HTTP server (main.ts): per
 * architecture.md, ingestion runs in a background job so uploads don't
 * block the request/response cycle. Run alongside the API:
 *
 *   DATABASE_URL=... REDIS_HOST=... npx ts-node src/reconciliations/reconciliation.worker.main.ts
 */
import { Pool } from 'pg';
import { createReconciliationWorker } from './reconciliation.worker';

function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString });
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
