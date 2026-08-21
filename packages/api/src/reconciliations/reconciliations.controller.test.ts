import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { Worker } from 'bullmq';
import { AppModule } from '../app.module';
import { MAX_FILE_SIZE_BYTES } from './upload-validation';
import { createReconciliationWorker } from './reconciliation.worker';
import { getReconciliationQueue, resetReconciliationQueueForTests } from './reconciliation.queue';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

/**
 * T04 — integration coverage for the actual HTTP wiring (multer parsing,
 * status codes/bodies). The exhaustive validation-rule matrix lives in
 * upload-validation.test.ts; this file only needs to prove the controller
 * is wired correctly end to end (RF-01..RF-02 acceptance criteria 1-4 from
 * voucher-ingestion.spec.md).
 *
 * T05 adds: tenant_id as a required field (RF-03 needs it to stage rows),
 * and an end-to-end test that runs a real BullMQ worker against the test
 * upload and asserts the rows actually landed in vouchers_staging.
 *
 * Note on AC3 (413): the fileSize limit is enforced by multer itself while
 * streaming, and @nestjs/platform-express maps that rejection straight to
 * a 413 PayloadTooLargeException — this test exercises that built-in Nest
 * behavior end to end rather than any filter of ours (there isn't one).
 */
describe('T04/T05: POST /api/reconciliations (integration)', () => {
  let app: INestApplication;
  let pool: Pool;
  let tenantId: string;
  let worker: Worker;

  beforeAll(async () => {
    resetReconciliationQueueForTests();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'reconciliations.controller.test');
    worker = createReconciliationWorker(pool);
  });

  afterAll(async () => {
    await worker.close();
    await getReconciliationQueue().close();
    await deleteTestTenant(pool, tenantId);
    await pool.end();
    await app.close();
  });

  it('AC1: returns 202 with job_id + status_url for two valid files + tenant_id', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe('string');
    expect(res.body.job_id.length).toBeGreaterThan(0);
    expect(res.body.status_url).toBe(`/api/reconciliations/${res.body.job_id}/status`);
  });

  it('T05: the enqueued job actually stages both files into vouchers_staging', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001\n30222222223,003'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(202);
    const jobId = res.body.job_id as string;

    const queue = getReconciliationQueue();
    const job = await queue.getJob(jobId);
    expect(job).toBeDefined();

    // Polling avoids needing a separate QueueEvents/Redis pub-sub listener
    // just for this test — we only need the terminal state.
    const deadline = Date.now() + 10000;
    let state = await job!.getState();
    while (state !== 'completed' && state !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      state = await job!.getState();
    }
    expect(state).toBe('completed');

    const { rows } = await pool.query(
      'SELECT file_source, count(*)::int AS n FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 GROUP BY file_source ORDER BY file_source',
      [tenantId, jobId],
    );
    expect(rows).toEqual([
      { file_source: 'arca', n: 2 },
      { file_source: 'contabilidad', n: 1 },
    ]);
  }, 15000);

  it('AC2: returns 400 with the RF-01 error message when only one file is attached', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Both ARCA and contabilidad files are required' });
  });

  it('AC2: returns 400 when no files are attached', async () => {
    const res = await request(app.getHttpServer()).post('/api/reconciliations');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Both ARCA and contabilidad files are required' });
  });

  it('AC4: returns 415 for a disallowed extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .attach('arca_file', Buffer.from('%PDF-1.4'), 'export.pdf')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Accepted types: csv, xlsx, xls' });
  });

  it('AC3: returns 413 when a file exceeds the 50MB limit (rejected by multer mid-stream)', async () => {
    const big = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024, 'a');
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .attach('arca_file', big, 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(413);
  }, 30000);

  it('T05: returns 400 when tenant_id is missing, even with two valid files', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
  });

  it('T05: returns 400 when tenant_id is not a UUID', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', 'not-a-uuid')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
  });
});
