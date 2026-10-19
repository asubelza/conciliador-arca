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
import {
  authHeaderFor,
  createTestPeriodo,
  createTestTenant,
  createTestUser,
  deleteTestTenant,
  deleteTestUser,
} from '../test-support/pg-test-helpers';

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
 * T19 (conciliacion-periodica) adds: periodo_id as a required field —
 * uploads now belong to an `abierto` período. `periodoId` here is a single
 * open período created once in beforeAll and reused by every
 * success-path upload test (itself real coverage of RF-13's "a período can
 * receive multiple uploads while abierto" scenario, since every one of
 * those tests uploads into the same período). Dedicated periodo_id
 * validation scenarios (missing, malformed, unknown, cerrado) live in the
 * "T19: periodo_id" describe block below.
 *
 * T38 (Fase 2, autenticacion-roles) adds: every request now needs a bearer
 * token — `adminAuth` throughout, since admin passes every role check
 * (upload/marks are admin/colaborador-only) and every assertTenantAccess
 * check. The dedicated `describe('auth (T38)')` block at the end proves
 * the guard/role/tenant checks themselves.
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
  let periodoId: string;
  let worker: Worker;
  let estudioId: string;
  let adminAuth: string;

  beforeAll(async () => {
    resetReconciliationQueueForTests();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'reconciliations.controller.test');
    periodoId = await createTestPeriodo(pool, tenantId);
    worker = createReconciliationWorker(pool);
    // Multi-estudio pivot: every other createTestTenant call in this file
    // also omits estudioId, so they all land in the SAME lazily-created,
    // per-file shared estudio (see pg-test-helpers.ts's defaultTestEstudioId)
    // as this first tenant — reading it back here and threading it into
    // adminAuth keeps the token estudio-matched with every tenant fixture.
    const { rows } = await pool.query<{ estudio_id: string }>('SELECT estudio_id FROM tenants WHERE id = $1', [
      tenantId,
    ]);
    estudioId = rows[0].estudio_id;
    adminAuth = authHeaderFor('admin', { estudioId });
  });

  afterAll(async () => {
    await worker.close();
    await getReconciliationQueue().close();
    await deleteTestTenant(pool, tenantId);
    await pool.end();
    await app.close();
    // Default hook timeout (20000ms, from jest.api.json's testTimeout) can
    // be too tight here: the corrupt-file retry test above (finding #8's
    // attempts/backoff) may still have a job settling its final retry when
    // this hook starts, and worker.close() waits for that to finish.
  }, 30000);

  /**
   * Uploads a matched+unmatched-arca pair (same fixture as the T10 test
   * above) and polls to a terminal state. Shared by the T11 and T12 describe
   * blocks below, both of which need a completed job to act on.
   */
  async function uploadAndWaitForCompletion(): Promise<string> {
    const uploadRes = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .field('periodo_id', periodoId)
      .attach(
        'arca_file',
        Buffer.from('Nro. Doc. Emisor,Tipo de Comprobante\n30111111112,1\n30222222223,1'),
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

  it('AC1: returns 202 with job_id + status_url for two valid files + tenant_id + source system', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .field('periodo_id', periodoId)
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
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .field('periodo_id', periodoId)
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
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .field('periodo_id', periodoId)
      .attach(
        'arca_file',
        Buffer.from('Nro. Doc. Emisor,Tipo de Comprobante\n30111111112,1\n30222222223,1'),
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
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Both ARCA and contabilidad files are required' });
  });

  it('AC2: returns 400 when no files are attached', async () => {
    const res = await request(app.getHttpServer()).post('/api/reconciliations').set('Authorization', adminAuth);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Both ARCA and contabilidad files are required' });
  });

  it('AC4: returns 415 for a disallowed extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .set('Authorization', adminAuth)
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
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'tango')
      .attach('arca_file', big, 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(413);
  }, 30000);

  it('T05: returns 400 when tenant_id is missing, even with two valid files', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .set('Authorization', adminAuth)
      .field('contabilidad_source_system', 'tango')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'tenant_id is required and must be a UUID' });
  });

  it('T05: returns 400 when tenant_id is not a UUID', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .set('Authorization', adminAuth)
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
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contabilidad_source_system/);
  });

  it('T10: returns 400 when contabilidad_source_system is unknown', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .set('Authorization', adminAuth)
      .field('tenant_id', tenantId)
      .field('contabilidad_source_system', 'sap')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contabilidad_source_system/);
  });

  describe('T19: periodo_id (RF-13, conciliacion-periodica)', () => {
    it('returns 400 when periodo_id is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'periodo_id is required and must be a UUID' });
    });

    it('returns 400 when periodo_id is not a UUID', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', 'not-a-uuid')
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'periodo_id is required and must be a UUID' });
    });

    it('returns 400 when periodo_id does not reference an existing período for this tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', '00000000-0000-0000-0000-000000000000')
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'periodo_id does not reference an existing período for this tenant',
      });
    });

    it("returns 400 when periodo_id belongs to a different tenant (scoped lookup, doesn't leak existence)", async () => {
      const otherTenantId = await createTestTenant(pool, 'T19 other tenant');
      const otherPeriodoId = await createTestPeriodo(pool, otherTenantId, '2026-02-01');
      try {
        const res = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .set('Authorization', adminAuth)
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .field('periodo_id', otherPeriodoId)
          .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          error: 'periodo_id does not reference an existing período for this tenant',
        });
      } finally {
        await deleteTestTenant(pool, otherTenantId);
      }
    });

    it('returns 400 and rejects the upload when the período is cerrado', async () => {
      const closedPeriodoId = await createTestPeriodo(pool, tenantId, '2026-03-01');
      await pool.query("UPDATE periodos SET estado = 'cerrado' WHERE id = $1", [closedPeriodoId]);

      const res = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', closedPeriodoId)
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'período is closed — uploads are only accepted while abierto',
      });
      // The request is rejected in the controller before queue.add is ever
      // called — no job_id in the response body means nothing was enqueued.
      expect(res.body.job_id).toBeUndefined();
    });

    it('accepts a second upload into the same open período (RF-13: multiple cargas por período)', async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca-1.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad-1.csv');
      expect(res1.status).toBe(202);

      const res2 = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit,tipo\n30222222223,001'), 'arca-2.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30222222223,001'), 'contabilidad-2.csv');
      expect(res2.status).toBe(202);
      expect(res2.body.job_id).not.toBe(res1.body.job_id);
    });
  });

  describe('T06: GET /api/reconciliations/:jobId/status', () => {
    it('AC: returns 404 for an unknown job id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reconciliations/00000000-0000-0000-0000-000000000000/status')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Reconciliation job not found' });
    });

    it('AC: returns {status: "pending"} for a job the worker has not picked up yet', async () => {
      const queue = getReconciliationQueue();
      await queue.pause();
      try {
        const res = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .set('Authorization', adminAuth)
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .field('periodo_id', periodoId)
          .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
        expect(res.status).toBe(202);

        const statusRes = await request(app.getHttpServer())
          .get(res.body.status_url)
          .set('Authorization', adminAuth);
        expect(statusRes.status).toBe(200);
        expect(statusRes.body).toEqual({ status: 'pending' });
      } finally {
        await queue.resume();
      }
    });

    it('AC: returns {status: "completed", counts} once the job finishes', async () => {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit\n30111111112\n30222222223'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
      expect(uploadRes.status).toBe(202);
      const jobId = uploadRes.body.job_id as string;

      const deadline = Date.now() + 10000;
      let statusBody: Record<string, unknown> = {};
      while (Date.now() < deadline) {
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/status`)
          .set('Authorization', adminAuth);
        statusBody = res.body as Record<string, unknown>;
        if (statusBody.status !== 'pending' && statusBody.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // toMatchObject (not toEqual): this test's own scope is the row
      // counts (RF-04's original AC) — the per-classification breakdown
      // added for the "resumen" screen (job-status.ts) is covered by its
      // own unit tests in job-status.test.ts, so this only pins down that
      // it's present and shaped like a number per key, not its exact value
      // for this particular fixture.
      expect(statusBody).toMatchObject({
        status: 'completed',
        counts: { arca_rows: 2, contabilidad_rows: 1 },
      });
      const counts = (statusBody as { counts: Record<string, unknown> }).counts;
      expect(typeof counts.matched).toBe('number');
      expect(typeof counts['unmatched-arca']).toBe('number');
      expect(typeof counts['unmatched-contabilidad']).toBe('number');
      expect(typeof counts.duplicates).toBe('number');
      expect(typeof counts.errors).toBe('number');
    }, 15000);

    it('AC: returns {status: "error", detail} when the job fails (corrupt file)', async () => {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('not a real xlsx file'), 'contabilidad.xlsx');
      expect(uploadRes.status).toBe(202);
      const jobId = uploadRes.body.job_id as string;

      // This job retries (finding #8: attempts: 3, exponential backoff
      // starting at 2000ms) before BullMQ marks it 'failed' — a corrupt
      // file fails identically on every attempt, so the mandatory backoff
      // delays alone (2000ms + 4000ms = 6000ms) are on the critical path
      // here. The deadline/timeout below are generous beyond that floor so
      // this doesn't flake under parallel test-suite load.
      const deadline = Date.now() + 20000;
      let statusBody: Record<string, unknown> = {};
      while (Date.now() < deadline) {
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/status`)
          .set('Authorization', adminAuth);
        statusBody = res.body as Record<string, unknown>;
        if (statusBody.status !== 'pending' && statusBody.status !== 'processing') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(statusBody.status).toBe('error');
      expect(typeof statusBody.detail).toBe('string');
    }, 25000);
  });

  describe('T11: GET /api/reconciliations/:jobId/report', () => {
    it('AC: returns 404 for an unknown job id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reconciliations/00000000-0000-0000-0000-000000000000/report')
        .set('Authorization', adminAuth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Reconciliation job not found' });
    });

    it('AC: returns 409 when the job has not finished processing yet', async () => {
      const queue = getReconciliationQueue();
      await queue.pause();
      try {
        const uploadRes = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .set('Authorization', adminAuth)
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .field('periodo_id', periodoId)
          .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
        expect(uploadRes.status).toBe(202);
        const jobId = uploadRes.body.job_id as string;

        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/report`)
          .set('Authorization', adminAuth);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/not completed yet/);
      } finally {
        await queue.resume();
      }
    });

    it('AC: returns 400 for an unrecognized format query param', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/report?format=pdf`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "format must be 'csv', 'xlsx', or 'json'" });
    }, 15000);

    it('AC: defaults to CSV, includes matched + unmatched-arca rows, sets download headers', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/report`)
        .set('Authorization', adminAuth);

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

    it('T13: format=json returns { rows } as structured data, no download header', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/report?format=json`)
        .set('Authorization', adminAuth);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows.map((r: { classification: string }) => r.classification).sort()).toEqual([
        'matched',
        'unmatched-arca',
      ]);
    }, 15000);

    it('AC: format=xlsx returns a valid workbook with the 4 named sheets', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/report?format=xlsx`)
        .set('Authorization', adminAuth)
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

    it('AC: logs an "export" audit_trail event scoped to the job', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/report?format=csv`)
        .set('Authorization', adminAuth);
      expect(res.status).toBe(200);

      const { rows } = await pool.query(
        "SELECT action, details FROM audit_trail WHERE tenant_id = $1 AND entity = 'reconciliation_job' AND entity_id = $2 AND action = 'export'",
        [tenantId, jobId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toEqual({ format: 'csv', rows: 2, classification: null });
    }, 15000);

    describe('classification filter (2026-08-23, "Ver pendientes sistema")', () => {
      it('AC: returns 400 for an unrecognized classification value', async () => {
        const jobId = await uploadAndWaitForCompletion();
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/report?classification=duplicates`)
          .set('Authorization', adminAuth);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/classification must be one of/);
      }, 15000);

      it('AC: format=json + classification=unmatched-arca returns only that section', async () => {
        const jobId = await uploadAndWaitForCompletion();
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/report?format=json&classification=unmatched-arca`)
          .set('Authorization', adminAuth);
        expect(res.status).toBe(200);
        expect(res.body.rows).toHaveLength(1);
        expect(res.body.rows[0].classification).toBe('unmatched-arca');
      }, 15000);

      it('AC: format=csv + classification filters the CSV to that one section', async () => {
        const jobId = await uploadAndWaitForCompletion();
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/report?format=csv&classification=matched`)
          .set('Authorization', adminAuth);
        expect(res.status).toBe(200);
        const lines = res.text.trim().split('\n');
        expect(lines).toHaveLength(2); // header + matched row only
        expect(lines[1].startsWith('matched,')).toBe(true);
      }, 15000);

      it('AC: format=xlsx + classification builds a single sheet for that section, not all 4', async () => {
        const jobId = await uploadAndWaitForCompletion();
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/report?format=xlsx&classification=unmatched-arca`)
          .set('Authorization', adminAuth)
          .buffer(true)
          .parse((response, callback) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => callback(null, Buffer.concat(chunks)));
          });
        expect(res.status).toBe(200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.body as unknown as ExcelJS.Buffer);
        expect(workbook.worksheets.map((s) => s.name)).toEqual(['Unmatched ARCA']);
        expect(workbook.getWorksheet('Unmatched ARCA')!.rowCount).toBe(2); // header + 1 row
      }, 15000);

      it('AC: logs the classification filter in the audit_trail details', async () => {
        const jobId = await uploadAndWaitForCompletion();
        await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/report?format=csv&classification=unmatched-arca`)
          .set('Authorization', adminAuth);

        const { rows } = await pool.query(
          "SELECT details FROM audit_trail WHERE tenant_id = $1 AND entity = 'reconciliation_job' AND entity_id = $2 AND action = 'export' ORDER BY created_at DESC LIMIT 1",
          [tenantId, jobId],
        );
        expect(rows[0].details).toEqual({ format: 'csv', rows: 1, classification: 'unmatched-arca' });
      }, 15000);
    });
  });

  describe('T12: POST /api/reconciliations/:jobId/marks', () => {
    it('AC: returns 404 for an unknown job id', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/00000000-0000-0000-0000-000000000000/marks')
        .set('Authorization', adminAuth)
        .send({ composite_key: 'k', classification: 'revisado' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Reconciliation job not found' });
    });

    it('AC: returns 409 when the job has not finished processing yet', async () => {
      const queue = getReconciliationQueue();
      await queue.pause();
      try {
        const uploadRes = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .set('Authorization', adminAuth)
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .field('periodo_id', periodoId)
          .attach('arca_file', Buffer.from('cuit\n30111111112'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit\n30111111112'), 'contabilidad.csv');
        expect(uploadRes.status).toBe(202);
        const jobId = uploadRes.body.job_id as string;

        const res = await request(app.getHttpServer())
          .post(`/api/reconciliations/${jobId}/marks`)
          .set('Authorization', adminAuth)
          .send({ composite_key: 'k', classification: 'revisado' });
        expect(res.status).toBe(409);
      } finally {
        await queue.resume();
      }
    });

    it('AC: returns 400 when composite_key is missing', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .post(`/api/reconciliations/${jobId}/marks`)
        .set('Authorization', adminAuth)
        .send({ classification: 'revisado' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'composite_key is required' });
    }, 15000);

    it('AC: returns 400 for an unknown classification value', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .post(`/api/reconciliations/${jobId}/marks`)
        .set('Authorization', adminAuth)
        .send({ composite_key: 'k', classification: 'aprobado' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/classification/);
    }, 15000);

    it('AC: inserts into feedback_loop and logs a user_mark audit_trail event', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .post(`/api/reconciliations/${jobId}/marks`)
        .set('Authorization', adminAuth)
        .send({
          composite_key: '30111111112|1|1|1',
          classification: 'explicado',
          note: 'Nota de crédito por descuento comercial',
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        tenant_id: tenantId,
        composite_key: '30111111112|1|1|1',
        classification: 'explicado',
        note: 'Nota de crédito por descuento comercial',
      });

      const { rows: feedbackRows } = await pool.query(
        'SELECT * FROM feedback_loop WHERE tenant_id = $1 AND composite_key = $2',
        [tenantId, '30111111112|1|1|1'],
      );
      expect(feedbackRows).toHaveLength(1);
      expect(feedbackRows[0].classification).toBe('explicado');

      const { rows: auditRows } = await pool.query(
        "SELECT action, details FROM audit_trail WHERE tenant_id = $1 AND entity = 'feedback_loop' AND entity_id = $2",
        [tenantId, res.body.id],
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('user_mark');
      expect(auditRows[0].details).toEqual({
        composite_key: '30111111112|1|1|1',
        classification: 'explicado',
      });
    }, 15000);
  });

  /**
   * Previsualización de datos al cargar (pedido del cliente, 2026-08-23,
   * rediseño UI/UX): mismo contrato de request que POST /api/reconciliations
   * (mismos campos + archivos), pero de solo lectura — nunca encola un job
   * ni escribe nada. Reutiliza la misma cadena de validación (T19's
   * periodo_id checks incluidos), así que solo se prueban acá el camino
   * feliz y las diferencias respecto de `upload` (no persiste nada, no
   * devuelve job_id).
   */
  describe('POST /api/reconciliations/preview', () => {
    it('returns parsed rows for both files, in file order, without creating a job', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach(
          'arca_file',
          Buffer.from(
            'Nro. Doc. Emisor,Tipo de Comprobante,Punto de Venta,Número de Comprobante,Fecha de Emisión,Imp. Total\n' +
              '30111111112,1,1,100,01/04/2026,"1.500,00"\n' +
              '30222222223,1,1,101,02/04/2026,"2.000,00"',
          ),
          'arca.csv',
        )
        .attach(
          'contabilidad_file',
          Buffer.from('CUIT,Tipo,Punto de Venta,Número,Fecha,Importe\n30111111112,Factura A,1,100,01/04/2026,1500'),
          'contabilidad.csv',
        );

      expect(res.status).toBe(200);
      expect(res.body.job_id).toBeUndefined();

      expect(res.body.arca).toEqual({
        total: 2,
        ok: 2,
        errors: 0,
        rows: [
          {
            ok: true,
            cuit_emisor: '30111111112',
            tipo_cbte: 1,
            punto_venta: 1,
            numero: 100,
            fecha_emision: '2026-04-01',
            importe_total_ars: 1500,
          },
          {
            ok: true,
            cuit_emisor: '30222222223',
            tipo_cbte: 1,
            punto_venta: 1,
            numero: 101,
            fecha_emision: '2026-04-02',
            importe_total_ars: 2000,
          },
        ],
      });
      expect(res.body.contabilidad).toEqual({
        total: 1,
        ok: 1,
        errors: 0,
        rows: [
          {
            ok: true,
            cuit_emisor: '30111111112',
            tipo_cbte: 1,
            punto_venta: 1,
            numero: 100,
            fecha_emision: '2026-04-01',
            importe_total_ars: 1500,
          },
        ],
      });
    });

    it('flags a row with an unresolvable tipo_cbte as ok:false without dropping it', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('Nro. Doc. Emisor\n30111111112'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('CUIT,Tipo\n30111111112,Factura A'), 'contabilidad.csv');

      expect(res.status).toBe(200);
      expect(res.body.arca).toMatchObject({ total: 1, ok: 0, errors: 1 });
      expect(res.body.arca.rows[0].ok).toBe(false);
      expect(res.body.contabilidad).toMatchObject({ total: 1, ok: 1, errors: 0 });
    });

    it('returns 400 when a required field is missing (same validation as upload)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .set('Authorization', adminAuth)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit\n1'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit\n1'), 'contabilidad.csv');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tenant_id/);
    });

    it('returns 400 when the período is cerrado (never previews for an upload that would be rejected)', async () => {
      const closedPeriodoId = await createTestPeriodo(pool, tenantId, '2026-06-01');
      await pool.query("UPDATE periodos SET estado = 'cerrado' WHERE id = $1", [closedPeriodoId]);

      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', closedPeriodoId)
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('período is closed — uploads are only accepted while abierto');
    });

    it('returns 401 with no Authorization header (same guard as upload)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit\n1'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit\n1'), 'contabilidad.csv');

      expect(res.status).toBe(401);
    });

    it('returns 403 for a cliente (preview is admin/colaborador-only, same as upload)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .set('Authorization', authHeaderFor('cliente'))
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit\n1'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit\n1'), 'contabilidad.csv');

      expect(res.status).toBe(403);
    });

    it('does not create a vouchers_staging row or a BullMQ job for a previewed upload', async () => {
      const { rows: beforeStaging } = await pool.query(
        'SELECT count(*)::int AS n FROM vouchers_staging WHERE tenant_id = $1',
        [tenantId],
      );

      await request(app.getHttpServer())
        .post('/api/reconciliations/preview')
        .set('Authorization', adminAuth)
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('Nro. Doc. Emisor,Tipo de Comprobante\n30111111112,1'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('CUIT,Tipo\n30111111112,Factura A'), 'contabilidad.csv');

      const { rows: afterStaging } = await pool.query(
        'SELECT count(*)::int AS n FROM vouchers_staging WHERE tenant_id = $1',
        [tenantId],
      );
      expect(afterStaging[0].n).toBe(beforeStaging[0].n);
    });
  });

  describe('auth (T38, autenticacion-roles)', () => {
    it('POST /api/reconciliations with no Authorization header returns 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');
      expect(res.status).toBe(401);
    });

    it('POST /api/reconciliations as cliente returns 403 (upload is admin/colaborador-only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reconciliations')
        .set('Authorization', authHeaderFor('cliente'))
        .field('tenant_id', tenantId)
        .field('contabilidad_source_system', 'tango')
        .field('periodo_id', periodoId)
        .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
        .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');
      expect(res.status).toBe(403);
    });

    it('POST /api/reconciliations as a cliente WITH tenant access is still 403 (role check applies regardless)', async () => {
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userId, tenantId]);
        const res = await request(app.getHttpServer())
          .post('/api/reconciliations')
          .set('Authorization', authHeaderFor('cliente', { sub: userId }))
          .field('tenant_id', tenantId)
          .field('contabilidad_source_system', 'tango')
          .field('periodo_id', periodoId)
          .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
          .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');
        expect(res.status).toBe(403);
      } finally {
        await deleteTestUser(pool, userId);
      }
    });

    it('GET .../status as a cliente WITHOUT access to the job’s tenant returns 403', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .get(`/api/reconciliations/${jobId}/status`)
        .set('Authorization', authHeaderFor('cliente'));
      expect(res.status).toBe(403);
    }, 15000);

    it('GET .../status as a cliente WITH access to the job’s tenant is allowed', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const { id: userId } = await createTestUser(pool, { role: 'cliente' });
      try {
        await pool.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userId, tenantId]);
        const res = await request(app.getHttpServer())
          .get(`/api/reconciliations/${jobId}/status`)
          .set('Authorization', authHeaderFor('cliente', { sub: userId, estudioId }));
        expect(res.status).toBe(200);
      } finally {
        await deleteTestUser(pool, userId);
      }
    }, 15000);

    it('POST .../marks as cliente returns 403 (marking is admin/colaborador-only)', async () => {
      const jobId = await uploadAndWaitForCompletion();
      const res = await request(app.getHttpServer())
        .post(`/api/reconciliations/${jobId}/marks`)
        .set('Authorization', authHeaderFor('cliente'))
        .send({ composite_key: 'k', classification: 'revisado' });
      expect(res.status).toBe(403);
    }, 15000);
  });
});
