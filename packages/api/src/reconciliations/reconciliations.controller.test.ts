import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { MAX_FILE_SIZE_BYTES } from './upload-validation';

/**
 * T04 — integration coverage for the actual HTTP wiring (multer parsing,
 * status codes/bodies). The exhaustive validation-rule matrix lives in
 * upload-validation.test.ts; this file only needs to prove the controller
 * is wired correctly end to end (RF-01..RF-02 acceptance criteria 1-4 from
 * voucher-ingestion.spec.md).
 *
 * Note on AC3 (413): the fileSize limit is enforced by multer itself while
 * streaming, and @nestjs/platform-express maps that rejection straight to
 * a 413 PayloadTooLargeException — this test exercises that built-in Nest
 * behavior end to end rather than any filter of ours (there isn't one).
 */
describe('T04: POST /api/reconciliations (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC1: returns 202 with job_id + status_url for two valid files', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .attach('arca_file', Buffer.from('cuit,tipo\n30111111112,001'), 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.xlsx');

    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe('string');
    expect(res.body.job_id.length).toBeGreaterThan(0);
    expect(res.body.status_url).toBe(`/api/reconciliations/${res.body.job_id}/status`);
  });

  it('AC2: returns 400 with the RF-01 error message when only one file is attached', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
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
      .attach('arca_file', Buffer.from('%PDF-1.4'), 'export.pdf')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Accepted types: csv, xlsx, xls' });
  });

  it('AC3: returns 413 when a file exceeds the 50MB limit (rejected by multer mid-stream)', async () => {
    const big = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024, 'a');
    const res = await request(app.getHttpServer())
      .post('/api/reconciliations')
      .attach('arca_file', big, 'arca.csv')
      .attach('contabilidad_file', Buffer.from('cuit,tipo\n30111111112,001'), 'contabilidad.csv');

    expect(res.status).toBe(413);
  }, 30000);
});
