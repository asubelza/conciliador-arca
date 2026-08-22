/**
 * reconciliation.worker.test.ts — T05 (RF-03) + T10 (RF-09). End-to-end:
 * real files on disk -> processReconciliationJob -> real rows in
 * vouchers_staging AND reconciliation_results, against the real PostgreSQL
 * test database. Exercises the transactional rollback guarantee (a corrupt
 * contabilidad file must not leave the already-staged arca rows behind).
 */
import { Pool } from 'pg';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { processReconciliationJob } from './reconciliation.worker';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

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

  it('stages both files, returns row + classification counts, deletes temp files after', async () => {
    const jobId = randomUUID();
    const arcaPath = await writeCsv('arca.csv', 5);
    const contabilidadPath = await writeCsv('contabilidad.csv', 3);

    const result = await processReconciliationJob(pool, jobId, {
      tenantId,
      contabilidadSourceSystem: 'tango',
      arca: { filePath: arcaPath, originalName: 'arca.csv', extension: 'csv' },
      contabilidad: { filePath: contabilidadPath, originalName: 'contabilidad.csv', extension: 'csv' },
    });

    // writeCsv's "cuit,numero" columns don't match any adapter's tipo
    // column, so every row's tipo is unresolved -> all 8 land in 'errors'.
    expect(result).toEqual({
      arca_rows: 5,
      contabilidad_rows: 3,
      matched: 0,
      'unmatched-arca': 0,
      'unmatched-contabilidad': 0,
      duplicates: 0,
      errors: 8,
    });

    const { rows } = await pool.query(
      'SELECT file_source, count(*)::int AS n FROM vouchers_staging WHERE tenant_id = $1 AND job_id = $2 GROUP BY file_source ORDER BY file_source',
      [tenantId, jobId],
    );
    expect(rows).toEqual([
      { file_source: 'arca', n: 5 },
      { file_source: 'contabilidad', n: 3 },
    ]);

    const { rows: resultRows } = await pool.query(
      'SELECT count(*)::int AS n FROM reconciliation_results WHERE tenant_id = $1 AND job_id = $2',
      [tenantId, jobId],
    );
    expect(resultRows[0].n).toBe(8);

    // T12 (RF-11): 'upload' + 'match' audit_trail events are logged inside
    // the same transaction as the job that produced them.
    const { rows: auditRows } = await pool.query(
      "SELECT action, details FROM audit_trail WHERE tenant_id = $1 AND entity = 'reconciliation_job' AND entity_id = $2 ORDER BY created_at",
      [tenantId, jobId],
    );
    expect(auditRows.map((r) => r.action)).toEqual(['upload', 'match']);
    expect(auditRows[0].details).toEqual({ rows: 8, arca_rows: 5, contabilidad_rows: 3 });
    expect(auditRows[1].details).toEqual({
      matched: 0,
      'unmatched-arca': 0,
      'unmatched-contabilidad': 0,
      duplicates: 0,
      errors: 8,
    });

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
        contabilidadSourceSystem: 'tango',
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

    const { rows: resultRows } = await pool.query(
      'SELECT * FROM reconciliation_results WHERE tenant_id = $1 AND job_id = $2',
      [tenantId, jobId],
    );
    expect(resultRows).toHaveLength(0);

    // T12: the 'upload' audit event is logged after both files stage, inside
    // the same transaction — a contabilidad-corrupt failure rolls it back
    // too (it never even got there: the corrupt file fails during staging,
    // before the 'upload' log call is reached).
    const { rows: auditRows } = await pool.query(
      "SELECT action FROM audit_trail WHERE tenant_id = $1 AND entity = 'reconciliation_job' AND entity_id = $2",
      [tenantId, jobId],
    );
    expect(auditRows).toHaveLength(0);
  });

  describe('T22 (RF-15, conciliacion-periodica): vouchers_canonical upsert', () => {
    it('upserts successfully-normalized vouchers into vouchers_canonical when periodoId is set', async () => {
      const periodoId = await createTestPeriodo(pool, tenantId, '2026-03-01');
      const jobId = randomUUID();
      const arcaPath = path.join(tmpDir, 'arca-t22.csv');
      const contabilidadPath = path.join(tmpDir, 'contabilidad-t22.csv');
      await fs.writeFile(
        arcaPath,
        'Nro. Doc. Receptor,Tipo de Comprobante\n30111111112,1\n30222222223,1',
        'utf8',
      );
      await fs.writeFile(contabilidadPath, 'CUIT,Tipo\n30111111112,Factura A', 'utf8');

      try {
        await processReconciliationJob(pool, jobId, {
          tenantId,
          contabilidadSourceSystem: 'tango',
          periodoId,
          arca: { filePath: arcaPath, originalName: 'arca-t22.csv', extension: 'csv' },
          contabilidad: { filePath: contabilidadPath, originalName: 'contabilidad-t22.csv', extension: 'csv' },
        });

        const { rows } = await pool.query(
          "SELECT file_source, estado, periodo_alta_id, cuit_emisor FROM vouchers_canonical WHERE tenant_id = $1 ORDER BY file_source, cuit_emisor",
          [tenantId],
        );
        expect(rows).toEqual([
          { file_source: 'arca', estado: 'pendiente', periodo_alta_id: periodoId, cuit_emisor: '30111111112' },
          { file_source: 'arca', estado: 'pendiente', periodo_alta_id: periodoId, cuit_emisor: '30222222223' },
          {
            file_source: 'contabilidad',
            estado: 'pendiente',
            periodo_alta_id: periodoId,
            cuit_emisor: '30111111112',
          },
        ]);

        const { rows: auditRows } = await pool.query(
          "SELECT details FROM audit_trail WHERE tenant_id = $1 AND entity = 'reconciliation_job' AND entity_id = $2 AND action = 'match'",
          [tenantId, jobId],
        );
        expect(auditRows[0].details.vouchers_canonical_upserted).toBe(3);
        expect(auditRows[0].details.vouchers_canonical_skipped_conciliado).toBe(0);
      } finally {
        await pool.query('DELETE FROM vouchers_canonical WHERE tenant_id = $1', [tenantId]);
      }
    }, 15000);

    it('does not touch vouchers_canonical when periodoId is absent (backward compat)', async () => {
      const jobId = randomUUID();
      const arcaPath = await writeCsv('arca-no-periodo.csv', 2);
      const contabilidadPath = await writeCsv('contabilidad-no-periodo.csv', 1);

      await processReconciliationJob(pool, jobId, {
        tenantId,
        contabilidadSourceSystem: 'tango',
        arca: { filePath: arcaPath, originalName: 'arca-no-periodo.csv', extension: 'csv' },
        contabilidad: { filePath: contabilidadPath, originalName: 'contabilidad-no-periodo.csv', extension: 'csv' },
      });

      const { rows } = await pool.query('SELECT count(*)::int AS n FROM vouchers_canonical WHERE tenant_id = $1', [
        tenantId,
      ]);
      expect(rows[0].n).toBe(0);
    }, 15000);
  });
});
