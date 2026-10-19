/**
 * estudio-access.ts — multi-estudio pivot: the one shared gate every
 * estudio-scoped controller route needs before it can list, create, or
 * mutate anything within "the caller's own estudio" (as opposed to a
 * specific tenant, which goes through tenant-access.ts's
 * assertTenantAccess instead).
 *
 * Originally written as a private copy inside tenants.controller.ts (PR4),
 * then duplicated verbatim into users.controller.ts (PR5) — caught in code
 * review on PR5 as the exact kind of drift risk tenants.controller.ts's
 * own doc comment on its copy already warned about (a fix to the 403
 * logic landing in one copy and silently missing the other). Factored out
 * here so both controllers — and platform/estudios.controller.ts (PR6)
 * later — share the one implementation.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { AuthenticatedUser } from './users-types';

export function requireEstudioId(user: AuthenticatedUser): string {
  if (user.estudio_id === null) {
    throw new HttpException({ error: 'no tenés acceso a este estudio' }, HttpStatus.FORBIDDEN);
  }
  return user.estudio_id;
}

/**
 * The mirror image of requireEstudioId(), for platform/estudios.controller.ts
 * (PR6): those routes manage estudios THEMSELVES, so they're for platform-
 * level staff ONLY — an estudio's own admin/colaborador (estudio_id set)
 * gets 403 here, same as platform staff gets 403 on every estudio-scoped
 * route elsewhere in this pivot. The two tiers are mutually exclusive by
 * design, never both-or-neither.
 */
export function requirePlatformStaff(user: AuthenticatedUser): void {
  if (user.estudio_id !== null) {
    throw new HttpException({ error: 'esta ruta es solo para staff de la plataforma' }, HttpStatus.FORBIDDEN);
  }
}
