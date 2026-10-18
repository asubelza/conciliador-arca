/**
 * tenant-access.ts — T37+ (Fase 2, autenticacion-roles/RF-14): the tenant
 * scoping half of authorization described in architecture.md's
 * "Autorización de tenant". A plain async function, not a decorator/guard —
 * same "direct function, no framework layer" style as validateTenantId,
 * validatePeriodoIdParam, etc. elsewhere in this codebase.
 *
 * admin/colaborador see every tenant implicitly (a single estudio's staff),
 * REGARDLESS of tenants.active (027) — a disabled tenant only blocks
 * cliente access, so staff can still reactivate it or do cleanup. cliente
 * needs an explicit row in user_tenant_access for that tenant AND
 * tenants.active = true, or this returns a 403 — never a 404, so a cliente
 * probing tenant ids can't distinguish "doesn't exist", "not yours", and
 * "disabled" (the 404 for a genuinely missing resource still comes from the
 * caller's own existence check, which callers should run before this when
 * the resource might not exist).
 */
import type { Pool } from 'pg';
import type { AuthenticatedUser } from './users-types';

export type AuthorizationFailure = { status: 403; error: string };

const FORBIDDEN_TENANT: AuthorizationFailure = { status: 403, error: 'no tenés acceso a este tenant' };

export async function assertTenantAccess(
  pool: Pool,
  user: AuthenticatedUser,
  tenantId: string,
): Promise<AuthorizationFailure | undefined> {
  if (user.role === 'admin' || user.role === 'colaborador') {
    return undefined;
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM user_tenant_access uta
     JOIN tenants t ON t.id = uta.tenant_id
     WHERE uta.user_id = $1 AND uta.tenant_id = $2 AND t.active = true`,
    [user.id, tenantId],
  );
  return rows.length > 0 ? undefined : FORBIDDEN_TENANT;
}
