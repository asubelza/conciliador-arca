/**
 * prisma/seed.ts
 *
 * Seeds `afip_tipo_map` with the canonical AFIP comprobante tipos sourced
 * from the shared-types catalogue (`AFIP_TIPOS_CADENCIAL` + `AFIP_TIPO_LABELS`),
 * so the seed can never drift from the canonical type list.
 *
 * `codigo` is a real AFIP integer tipo code (1=Factura A, 6=Factura B, …),
 * not the disconnected zero-padded 3-digit scheme this seed used before
 * 2026-08-22 — see shared-types' module doc and
 * conciliacion-periodica/stock-historico-comprobantes.spec.md (RF-14) for
 * why: that old scheme was never wired to any real adapter, and had to be
 * unified with the codes every real code path actually produces before
 * `vouchers_canonical` could be used as real persistent stock.
 *
 * The seed is expressed as pure, DB-agnostic functions (generateSeedRows /
 * generateSeedSql / runSeed) so it can be unit-tested against in-memory SQLite
 * (no PostgreSQL available in this environment) and executed for real against
 * PostgreSQL via `seed-runner.ts`.
 */
import { AFIP_TIPOS_CADENCIAL, AFIP_TIPO_LABELS } from 'shared-types';

export interface AfipTipoRow {
  codigo: number;
  descripcion: string;
  activo: boolean;
}

/** Canonical AFIP tipos, derived 1:1 from the shared-types catalogue. */
export function generateSeedRows(): AfipTipoRow[] {
  return AFIP_TIPOS_CADENCIAL.map((codigo) => ({
    codigo,
    descripcion: AFIP_TIPO_LABELS[codigo],
    activo: true,
  }));
}

/**
 * Portable INSERT statement for the canonical tipos.
 *
 * `created_at` is intentionally omitted so the production PostgreSQL column
 * default `now()` applies (and SQLite's CURRENT_TIMESTAMP default fires in
 * tests). This keeps a single SQL string portable across both engines.
 */
export function generateSeedSql(): string {
  const rows = generateSeedRows();
  const tuples = rows.map((r) =>
    `(${r.codigo}, '${r.descripcion}', ${r.activo ? 'TRUE' : 'FALSE'})`,
  );
  return (
    'INSERT INTO afip_tipo_map (codigo, descripcion, activo) VALUES\n  ' +
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
