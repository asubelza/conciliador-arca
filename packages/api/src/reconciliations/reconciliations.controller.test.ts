import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { Worker } from 'bullmq';
import ExcelJS from 'exceljs';
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
 * T10 adds: contabilidad_source_system as a required field (selects the
 * column adapter — see upload-validation.ts), and asserts the worker's
 * classification results actually land in reconciliation_results.
 *
 * Note on AC3 (413): the fileSize limit is enforced by multer itself while
 * streaming, and @nestjs/platform-express maps that rejection straight to
 * a 413 PayloadTooLargeException — this test exercises that built-in Nest
 * behavior end to end rather than any filter of ours (there isn't one).
 */
describe('T04/T05/T10: POST /api/reconciliations (integration)', () => {
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

  it('AC1: returns 202 with job_id + status_url for two valid files + tenant_id + source system', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
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
      .field('contabilidad_source_system', 'tango')
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

  it('T10: the enqueued job classifies and persists reconciliation_results', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .attach(
        'arca_file',
        Buffer.from('Nro. Doc. Receptor,Tipo de Comprobante\n30111111112,1\n30222222223,1'),
        'arca.csv',
      )
      .attach('contabilidad_file', Buffer.from('CUIT,Tipo\n30111111112,Factura A'), 'contabilidad.csv');

    expect(res.status).toBe(202);
    const jobId = res.body.job_id as string;

    const queue = getReconciliationQueue();
    const job = await queue.getJob(jobId);
    const deadline = Date.now() + 10000;
    let state = await job!.getState();
    while (state !== 'completed' && state !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      state = await job!.getState();
    }
    expect(state).toBe('completed');

    const { rows } = await pool.query(
      'SELECT tipo_clasificacion, count(*)::int AS n FROM reconciliation_results WHERE tenant_id = $1 AND job_id = $2 GROUP BY tipo_clasificacion ORDER BY tipo_clasificacion',
      [tenantId, jobId],
    );
    // arca row 1 (CUIT 30111111112) matches the single contabilidad row;
    // arca row 2 (CUIT 30222222223) has no contabilidad counterpart.
    expect(rows).toEqual([
      { tipo_clasificacion: 'matched', n: 1 },
      { tipo_clasificacion: 'unmatched-arca', n: 1 },
    ]);
  }, 15000);

  it('AC2: returns 400 with the RF-01 error message when only one file is attached', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
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
      .field('contabilidad_source_system', 'tango')
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
      .field('contabilidad_source_system', 'tango')
      .attach('arca_file', big, 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(413);
  }, 30000);

  it('T05: returns 400 when tenant_id is missing, even with two valid files', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('contabilidad_source_system', 'tango')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
  });

  it('T05: returns 400 when tenant_id is not a UUID', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', 'not-a-uuid')
      .field('contabilidad_source_system', 'tango')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
  });

  it('T10: returns 400 when contabilidad_source_system is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contabilidad_source_system/);
  });

  it('T10: returns 400 when contabilidad_source_system is unknown', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'sap')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contabilidad_source_system/);
  });

  describe('T06: GET /api/reconciliations/:jobId/status', () => {
    it('AC: returns 404 for an unknown job id', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/reconciliations/00000000-0000-0000-0000-000000000000/status',
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Reconciliation job not found' });
    });

    it('AC: returns {status: "pending"} for a job the worker has not picked up yet', async () => {
      const queue = getReconciliationQueue();
      await queue.pause();
      try {
        const res = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
        expect(res.status).toBe(202);

        const statusRes = await request(app.getHttpServer()).get(res.body.status_url);
        expect(statusRes.status).toBe(200);
        expect(statusRes.body).toEqual({ status: 'pending' });
      } finally {
        await queue.resume();
      }
    });

    it('AC: returns {status: "completed", counts} once the job finishes', async () => {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .attach('arca_file', Buffer.from('cuit\n30111111112\n30222222223'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
      expect(uploadRes.status).toBe(202);
      const jobId = uploadRes.body.job_id as string;

      const deadline = Date.now() + 10000;
      let statusBody: Record<string, unknown> = {};
      while (Date.now() < deadline) {
        const res = await request(app.getHttpServer()).get(`/api/reconciliations/${jobId}/status`);
        statusBody = res.body as Record<string, unknown>;
        if (statusBody.status !== 'pending' && statusBody.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(statusBody).toEqual({
        status: 'completed',
        counts: { arca_rows: 2, contabilidad_rows: 1 },
      });
    }, 15000);

    it('AC: returns {status: "error", detail} when the job fails (corrupt file)', async () => {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('not a real xlsx file'), 'contabilidad.xlsx');
      expect(uploadRes.status).toBe(202);
      const jobId = uploadRes.body.job_id as string;

      const deadline = Date.now() + 10000;
      let statusBody: Record<string, unknown> = {};
      while (Date.now() < deadline) {
        const res = await request(app.getHttpServer()).get(`/api/reconciliations/${jobId}/status`);
        statusBody = res.body as Record<string, unknown>;
        if (statusBody.status !== 'pending' && statusBody.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(statusBody.status).toBe('error');
      expect(typeof statusBody.detail).toBe('string');
    }, 15000);
  });

  describe('T11: GET /api/reconciliations/:jobId/report', () => {
    /** Uploads a matched+unmatched-arca pair (same fixture as the T10 test above) and polls to a terminal state. */
    async function uploadAndWaitForCompletion(): Promise<string> {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .attach(
          'arca_file',
          Buffer.from('Nro. Doc. Receptor,Tipo de Comprobante\n30111111112,1\n30222222223,1'),
          'arca.csv',
        )
        .attach('contabilidad_file', Buffer.from('CUIT,Tipo\n30111111112,Factura A'), 'contabilidad.csv');
      expect(uploadRes.status).toBe(202);
      const jobId = uploadRes.body.job_id as string;

      const queue = getReconciliationQueue();
      const job = await queue.getJob(jobId);
      const deadline = Date.now() + 10000;
      let state = await job!.getState();
      while (state !== 'completed' && state !== 'failed' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        state = await job!.getState();
      }
      expect(state).toBe('completed');
      return jobId;
    }

    it('AC: returns 404 for an unknown job id', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/reconciliations/00000000-0000-0000-0000-000000000000/report',
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Reconciliation job not found' });
    });

    it('AC: returns 409 when the job has not finished processing yet', async () => {
      const queue = getReconciliationQueue();
      await queue.pause();
      try {
        const uploadRes = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
        expect(uploadRes.status).toBe(202);
        const jobId = uploadRes.body.job_id as string;

        const res = await request(app.getHttpServer()).get(`/api/reconciliations/${jobId}/report`);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/not completed yet/);
      } finally {
        await queue.resume();
      }
    });

    it('AC: returns 400 for an unrecognized format query param', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer()).get(`/api/reconciliations/${jobId}/report?format=pdf`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "format must be 'csv' or 'xlsx'" });
    }, 15000);

    it('AC: defaults to CSV, includes matched + unmatched-arca rows, sets download headers', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer()).get(`/api/reconciliations/${jobId}/report`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="reconciliation-${jobId}.csv"`,
      );

      const lines = res.text.trim().split('\n');
      expect(lines[0]).toBe('classification,composite_key,arca_importe,contabilidad_importe,delta,iva_amount,cae,fecha_emision');
      expect(lines).toHaveLength(3); // header + matched + unmatched-arca
      expect(lines.some((l: string) => l.startsWith('matched,'))).toBe(true);
      expect(lines.some((l: string) => l.startsWith('unmatched-arca,'))).toBe(true);
    }, 15000);

    it('AC: format=xlsx returns a valid workbook with the 4 named sheets', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/report?format=xlsx`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="reconciliation-${jobId}.xlsx"`,
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      expect(workbook.worksheets.map((s) => s.name)).toEqual([
        'Matched',
        'Unmatched ARCA',
        'Unmatched Contabilidad',
        'Errors',
      ]);
      expect(workbook.getWorksheet('Matched')!.rowCount).toBe(2); // header + 1 matched row
    }, 15000);
  });
});
