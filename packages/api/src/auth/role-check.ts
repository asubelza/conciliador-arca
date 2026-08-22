/**
 * role-check.ts — T37+ (Fase 2, autenticacion-roles/RF-14): the role half
 * of authorization described in architecture.md — a plain function, no DB
 * round-trip needed (role is already on req.user, set by AuthGuard from
 * the JWT payload). Used for the write actions architecture.md restricts
 * to admin/colaborador (uploads, período create/cerrar, marks, tenant
 * config PUT) — every GET stays open to all 3 roles, subject to
 * assertTenantAccess.
 */
import type { AuthenticatedUser, UserRole } from './users-types';

export type AuthorizationFailure = { status: 403; error: string };

export function assertRole(user: AuthenticatedUser, allowed: UserRole[]): AuthorizationFailure | undefined {
  return allowed.includes(user.role) ? undefined : { status: 403, error: 'tu rol no tiene permiso para esta acción' };
}
