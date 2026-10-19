/**
 * tenant-access.ts — T37+ (Fase 2, autenticacion-roles/RF-14), re-scoped by
 * the multi-estudio pivot: the tenant scoping half of authorization
 * described in architecture.md's "Autorización de tenant". A plain async
 * function, not a decorator/guard — same "direct function, no framework
 * layer" style as validateTenantId, validatePeriodoIdParam, etc. elsewhere
 * in this codebase.
 *
 * `estudios` is now the top-level isolation boundary, ABOVE tenants:
 * - A platform-level staff user (`estudio_id === null`) has NO implicit
 *   access to any estudio's tenants — isolating estudios from each other,
 *   including from the platform operator, is the entire point of this
 *   pivot. This is checked first, before role, and short-circuits to 403.
 * - admin/colaborador see every tenant WITHIN THEIR OWN estudio,
 *   REGARDLESS of tenants.active (027) — a disabled tenant only blocks
 *   cliente access, so staff can still reactivate it or do cleanup. This is
 *   now a real query (1 round trip) instead of an unconditional pass — an
 *   accepted, deliberate tradeoff for estudio isolation, not a bug.
 * - cliente needs an explicit row in user_tenant_access for that tenant,
 *   tenants.active = true, AND the tenant's estudio_id must match the
 *   cliente's own estudio_id (defense-in-depth: a cliente's tenant_ids
 *   should never cross estudios by construction, but this is enforced here
 *   too).
 * Any failure returns a 403 — never a 404, so a caller probing tenant ids
 * can't distinguish "doesn't exist", "not yours", "disabled", and "wrong
 * estudio" (the 404 for a genuinely missing resource still comes from the
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
  if (user.estudio_id === null) {
    // Platform-level staff: no implicit access to any estudio's tenants —
    // isolating estudios from each other (including from the platform
    // operator) is the entire point of this pivot.
    return FORBIDDEN_TENANT;
  }

  if (user.role === 'admin' || user.role === 'colaborador') {
    const { rows } = await pool.query(`SELECT 1 FROM tenants WHERE id = $1 AND estudio_id = $2`, [
      tenantId,
      user.estudio_id,
    ]);
    return rows.length > 0 ? undefined : FORBIDDEN_TENANT;
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM user_tenant_access uta
     JOIN tenants t ON t.id = uta.tenant_id
     WHERE uta.user_id = $1 AND uta.tenant_id = $2 AND t.active = true AND t.estudio_id = $3`,
    [user.id, tenantId, user.estudio_id],
  );
  return rows.length > 0 ? undefined : FORBIDDEN_TENANT;
}
