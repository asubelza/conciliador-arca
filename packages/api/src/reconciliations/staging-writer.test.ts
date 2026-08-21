/**
 * staging-writer.test.ts — T05 (RF-03). Integration tests against the real
 * PostgreSQL test database (see jest.setup-env.ts) — this project has
 * Postgres available in this environment, unlike PR-1 (see
 * openspec/progress/PR-1.md deviation #1), so staging is verified by
 * actually running COPY FROM STDIN, not just structural assertions.
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { writeRowsToStaging } from './staging-writer';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';
import type { RawRow } from './file-row-stream';

describe('T05 RF-03: writeRowsToStaging (COPY FROM STDIN)', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'staging-writer.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  async function* rowsOf(n: number): AsyncGenerator<RawRow> {
    for (let i = 0; i < n; i++) {
      yield { cuit: '30111111112', numero: String(i) };
    }
  }

  it('stages 1,000 rows via COPY FROM STDIN, tagged with file_source', async () => {
    const jobId = randomUUID();
    const client = await pool.connect();
    try {
      const result = await writeRowsToStaging(client, tenantId, jobId, 'arca', rowsOf(1000));
      expect(result.rowCount).toBe(1000);
    } finally {
      client.release();
    }

    // No ORDER BY on insertion order exists in vouchers_staging (it's an
    // unindexed staging table by design — see 003_init_voucher_staging.sql),
    // so sort by the numero we embedded in raw_data rather than assuming
    // row 0 in the result set is row 0 as written.
    const { rows } = await pool.query(
      `SELECT file_source, job_id, raw_data FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 ORDER BY (raw_data->>'numero')::int`,
      [tenantId, jobId],
    );
    expect(rows).toHaveLength(1000);
    expect(rows.every((r) => r.file_source === 'arca')).toBe(true);
    expect(rows.every((r) => r.job_id === jobId)).toBe(true);
    expect(rows[0].raw_data).toEqual({ cuit: '30111111112', numero: '0' });
  });

  it('tags rows from the contabilidad file separately from arca', async () => {
    const jobId = randomUUID();
    const client = await pool.connect();
    try {
      await writeRowsToStaging(client, tenantId, jobId, 'arca', rowsOf(3));
      await writeRowsToStaging(client, tenantId, jobId, 'contabilidad', rowsOf(2));
    } finally {
      client.release();
    }

    const { rows: arcaRows } = await pool.query(
      `SELECT * FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 AND file_source = 'arca'`,
      [tenantId, jobId],
    );
    const { rows: contRows } = await pool.query(
      `SELECT * FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 AND file_source = 'contabilidad'`,
      [tenantId, jobId],
    );
    expect(arcaRows).toHaveLength(3);
    expect(contRows).toHaveLength(2);
  });

  it('rolls back via COPY abort when the row source throws mid-stream', async () => {
    const jobId = randomUUID();
    async function* explodingRows(): AsyncGenerator<RawRow> {
      yield { cuit: '1' };
      yield { cuit: '2' };
      throw new Error('corrupt row mid-stream');
    }

    const client = await pool.connect();
    try {
      await expect(
        writeRowsToStaging(client, tenantId, jobId, 'arca', explodingRows()),
      ).rejects.toThrow(/corrupt row mid-stream/);
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT * FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2`,
      [tenantId, jobId],
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown file_source at the DB constraint level', async () => {
    const jobId = randomUUID();
    const client = await pool.connect();
    try {
      await expect(
        // @ts-expect-error - intentionally invalid file_source to prove the CHECK constraint holds
        writeRowsToStaging(client, tenantId, jobId, 'not-a-real-source', rowsOf(1)),
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });
});
