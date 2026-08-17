/**
 * prisma/seed.ts
 *
 * Seeds `afip_tipo_map` with the 15 canonical AFIP comprobante tipos sourced
 * from the shared-types catalogue (`AFIP_TIPOS_CADENCIAL` + `AFIP_TIPO_LABELS`),
 * so the seed can never drift from the canonical type list.
 *
 * The seed is expressed as pure, DB-agnostic functions (generateSeedRows /
 * generateSeedSql / runSeed) so it can be unit-tested against in-memory SQLite
 * (no PostgreSQL available in this environment) and executed for real against
 * PostgreSQL via `prisma db seed` once the `pg`/Prisma client wiring exists.
 */
import { AFIP_TIPOS_CADENCIAL, AFIP_TIPO_LABELS } from 'shared-types';

export interface AfipTipoRow {
  tipo: string;
  descripcion: string;
  activo: boolean;
}

/** Canonical 15 AFIP tipos, derived 1:1 from the shared-types catalogue. */
export function generateSeedRows(): AfipTipoRow[] {
  return AFIP_TIPOS_CADENCIAL.map((tipo) => ({
    tipo,
    descripcion: AFIP_TIPO_LABELS[tipo],
    activo: true,
  }));
}

/**
 * Portable INSERT statement for the 15 tipos.
 *
 * `created_at` is intentionally omitted so the production PostgreSQL column
 * default `now()` applies (and SQLite's CURRENT_TIMESTAMP default fires in
 * tests). This keeps a single SQL string portable across both engines.
 */
export function generateSeedSql(): string {
  const rows = generateSeedRows();
  const tuples = rows.map((r) =>
    `('${r.tipo}', '${r.descripcion}', ${r.activo ? 'TRUE' : 'FALSE'})`,
  );
  return (
    'INSERT INTO afip_tipo_map (tipo, descripcion, activo) VALUES\n  ' +
    tuples.join(',\n  ') +
    ';\n'
  );
}

/**
 * Executes the seed via an injected executor (DB-agnostic).
 * @param exec runs a SQL string against the target database
 * @returns the number of rows the seed inserted
 */
export async function runSeed(
  exec: (sql: string) => Promise<void>,
): Promise<number> {
  const rows = generateSeedRows();
  await exec(generateSeedSql());
  return rows.length;
}
