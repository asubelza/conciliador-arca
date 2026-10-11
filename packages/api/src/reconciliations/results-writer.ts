/**
 * results-writer.ts — T10: persists classification-engine.ts's
 * `ClassifiedResult[]` into `reconciliation_results` via COPY FROM STDIN
 * (same approach as staging-writer.ts, for the same reason: bounded memory
 * regardless of how many results a job produces).
 *
 * `arca_row`/`contabilidad_row` are NULL (not `{}`) when that side is
 * absent (e.g. an `unmatched-arca` row has no contabilidad counterpart) —
 * in Postgres's CSV COPY format the default NULL representation is an
 * *unquoted* empty field, so those columns are written with no quoting at
 * all rather than through the same quoted-escape path as the other
 * columns.
 */
import type { PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ClassifiedResult } from './classification-engine';

function csvField(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

/** Unquoted empty = SQL NULL in Postgres's CSV COPY format; see module doc. */
function csvNullableJsonField(value: unknown): string {
  return value === undefined ? '' : csvField(JSON.stringify(value));
}

function toCopyLine(tenantId: string, jobId: string, result: ClassifiedResult): string {
  return (
    [
      csvField(tenantId),
      csvField(jobId),
      csvField(result.composite_key),
      csvNullableJsonField(result.arca),
      csvNullableJsonField(result.contabilidad),
      csvField(result.classification),
      csvField(String(result.iva_amount)),
    ].join(',') + '\n'
  );
}

export async function writeResultsToDb(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  results: ClassifiedResult[],
): Promise<number> {
  if (results.length === 0) return 0;

  async function* lines(): AsyncGenerator<string> {
    for (const result of results) {
      yield toCopyLine(tenantId, jobId, result);
    }
  }

  const source = Readable.from(lines());
  const copyStream = client.query(
    copyFrom(
      'COPY reconciliation_results (tenant_id, job_id, composite_key, arca_row, contabilidad_row, tipo_clasificacion, iva_impacto) FROM STDIN WITH (FORMAT csv)',
    ),
  );
  await pipeline(source, copyStream);

  return results.length;
}
