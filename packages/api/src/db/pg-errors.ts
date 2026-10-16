/**
 * pg-errors.ts — shared Postgres error-code helpers. Extracted because
 * isUniqueViolation was independently defined in periodos.controller.ts
 * and (backoffice self-service) users.controller.ts; isForeignKeyViolation
 * is new, needed by users.controller.ts to translate a nonexistent
 * tenant_id into a clean 400 instead of a raw 500.
 */
function hasPgErrorCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

export function isUniqueViolation(err: unknown): boolean {
  return hasPgErrorCode(err, '23505');
}

export function isForeignKeyViolation(err: unknown): boolean {
  return hasPgErrorCode(err, '23503');
}
