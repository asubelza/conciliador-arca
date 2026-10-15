/**
 * voucher-estado.ts — the set of `vouchers_canonical.estado` values that
 * are terminal for matching purposes: once a voucher is `conciliado` OR
 * `archivado` (024_alter_vouchers_canonical_estado_add_archivado.sql), it
 * must never re-enter any matching pool and must never be silently
 * overwritten by a re-upload.
 *
 * Before this constant existed, every one of these checks hand-duplicated
 * the same two-value list as a literal string in 5+ places across 3 files
 * (vouchers-canonical-writer.ts, periodo-matching-engine.ts,
 * comprobante-arca-archivar.ts) — a code review caught that
 * `resolverPendienteArca` (periodos.controller.ts) was never updated when
 * `archivado` was introduced, silently letting it flip an archivado
 * voucher straight to conciliado with no guard at all. A single shared
 * constant doesn't prevent a future terminal estado from needing the same
 * audit again, but it means there's exactly one place to find, not an
 * unknown number of hand-written copies to grep for.
 */
export const TERMINAL_VOUCHER_ESTADOS = ['conciliado', 'archivado'] as const;

export type TerminalVoucherEstado = (typeof TERMINAL_VOUCHER_ESTADOS)[number];

export function isTerminalVoucherEstado(estado: string): boolean {
  return (TERMINAL_VOUCHER_ESTADOS as readonly string[]).includes(estado);
}

/** Literal SQL fragment for `WHERE`/`AND` clauses — splice into a template literal, e.g. `` `... AND ${NON_TERMINAL_ESTADO_SQL}` ``. */
export const NON_TERMINAL_ESTADO_SQL = `estado NOT IN ('conciliado', 'archivado')`;
