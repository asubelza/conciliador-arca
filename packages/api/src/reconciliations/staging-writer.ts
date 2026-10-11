/**
 * staging-writer.ts — T05 (RF-03): streams rows into `vouchers_staging` via
 * `COPY FROM STDIN`, tagging each row with tenant_id/job_id/file_source.
 *
 * Uses `pg-copy-streams` so rows flow straight from the file parser
 * (file-row-stream.ts) into the COPY stream without ever materializing the
 * full row set as a JS array — memory use stays bounded regardless of file
 * size. If the row source throws mid-stream (corrupt file), the pipeline
 * error propagates into the COPY stream, which sends `CopyFail` to
 * PostgreSQL; PostgreSQL aborts that COPY atomically, so no partial rows
 * from a failed COPY are ever visible (RF-03's "corrupt XLS parsing
 * mid-stream" scenario).
 */
import type { PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { RawRow } from './file-row-stream';

export type FileSource = 'arca' | 'contabilidad';

export interface StagingWriteResult {
  rowCount: number;
}

function csvEscapeField(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

function toCopyLine(tenantId: string, jobId: string, fileSource: FileSource, row: RawRow): string {
  const json = JSON.stringify(row);
  return (
    [csvEscapeField(tenantId), csvEscapeField(jobId), csvEscapeField(fileSource), csvEscapeField(json)].join(
      ',',
    ) + '\n'
  );
}

/**
 * Streams `rows` into vouchers_staging on the given client (caller owns the
 * client's transaction boundary — see reconciliation.worker.ts, which wraps
 * both files' writes in a single BEGIN/COMMIT so a job either stages
 * completely or not at all).
 */
export async function writeRowsToStaging(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  fileSource: FileSource,
  rows: AsyncIterable<RawRow>,
): Promise<StagingWriteResult> {
  let rowCount = 0;

  async function* lines(): AsyncGenerator<string> {
    for await (const row of rows) {
      rowCount++;
      yield toCopyLine(tenantId, jobId, fileSource, row);
    }
  }

  const source = Readable.from(lines());
  const copyStream = client.query(
    copyFrom('COPY vouchers_staging (tenant_id, job_id, file_source, raw_data) FROM STDIN WITH (FORMAT csv)'),
  );
  await pipeline(source, copyStream);

  return { rowCount };
}
