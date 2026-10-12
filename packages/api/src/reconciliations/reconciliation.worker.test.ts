/**
 * reconciliation.worker.test.ts — T05 (RF-03). End-to-end: real files on
 * disk -> processReconciliationJob -> real rows in vouchers_staging,
 * against the real PostgreSQL test database. Exercises the transactional
 * rollback guarantee (a corrupt contabilidad file must not leave the
 * already-staged arca rows behind).
 */
import { Pool } from 'pg';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { processReconciliationJob } from './reconciliation.worker';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

describe('T05 RF-03: processReconciliationJob', () => {
  let pool: Pool;
  let tenantId: string;
  let tmpDir: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'reconciliation.worker.test');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconciliation-worker-test-'));
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await fs.rm(tmpDir, { recursive: true, force: true });
    await pool.end();
  });

  async function writeCsv(name: string, rowCount: number): Promise<string> {
    const filePath = path.join(tmpDir, name);
    let content = 'cuit,numero\n';
    for (let i = 0; i < rowCount; i++) content += `30111111112,${i}\n`;
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('stages both files and returns row counts; deletes temp files after', async () => {
    const jobId = randomUUID();
    const arcaPath = await writeCsv('arca.csv', 5);
    const contabilidadPath = await writeCsv('contabilidad.csv', 3);

    const result = await processReconciliationJob(pool, jobId, {
      tenantId,
      arca: { filePath: arcaPath, originalName: 'arca.csv', extension: 'csv' },
      contabilidad: { filePath: contabilidadPath, originalName: 'contabilidad.csv', extension: 'csv' },
    });

    expect(result).toEqual({ arca_rows: 5, contabilidad_rows: 3 });

    const { rows } = await pool.query(
      'SELECT file_source, count(*)::int AS n FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 GROUP BY file_source ORDER BY file_source',
      [tenantId, jobId],
    );
    expect(rows).toEqual([
      { file_source: 'arca', n: 5 },
      { file_source: 'contabilidad', n: 3 },
    ]);

    await expect(fs.access(arcaPath)).rejects.toThrow();
    await expect(fs.access(contabilidadPath)).rejects.toThrow();
  });

  it('rolls back the whole job (including the already-staged arca rows) when contabilidad is corrupt', async () => {
    const jobId = randomUUID();
    const arcaPath = await writeCsv('arca-2.csv', 4);
    const corruptPath = path.join(tmpDir, 'contabilidad-corrupt.xlsx');
    await fs.writeFile(corruptPath, 'not a real xlsx', 'utf8');

    await expect(
      processReconciliationJob(pool, jobId, {
        tenantId,
        arca: { filePath: arcaPath, originalName: 'arca-2.csv', extension: 'csv' },
        contabilidad: {
          filePath: corruptPath,
          originalName: 'contabilidad-corrupt.xlsx',
          extension: 'xlsx',
        },
      }),
    ).rejects.toBeTruthy();

    const { rows } = await pool.query(
      'SELECT * FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2',
      [tenantId, jobId],
    );
    expect(rows).toHaveLength(0);
  });
});
