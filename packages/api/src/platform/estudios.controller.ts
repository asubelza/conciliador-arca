/**
 * estudios.controller.ts — multi-estudio pivot (PR6/8): the platform-level
 * counterpart to tenants.controller.ts/users.controller.ts. Manages the
 * estudios themselves — CRUD + inviting an estudio's first admin — not
 * what's inside one. Separate top-level route (`api/platform/estudios`,
 * not nested under `api/tenants` or `api/users`) and separate module
 * (PlatformModule), same "own module per domain" posture as
 * TenantsModule/UsersModule.
 *
 * Every route requires platform-level staff (assertRole admin/colaborador
 * AND user.estudio_id === null, via requirePlatformStaff()) — an estudio's
 * own admin/colaborador gets 403 here, the exact mirror of platform staff
 * getting 403 on tenants.controller.ts/users.controller.ts's own routes.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import { assertRole } from '../auth/role-check';
import { requirePlatformStaff } from '../auth/estudio-access';
import { isForeignKeyViolation, isUniqueViolation } from '../db/pg-errors';
import { isUuid } from '../tenants/tenants-validation';
import { createUser } from '../auth/users.service';
import { validateCreateEstudioBody, validateInviteAdminBody } from './platform-estudios-validation';

export interface EstudioRow {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function requirePlatformAdmin(req: AuthenticatedRequest): void {
  const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
  if (roleFailure) {
    throw new HttpException({ error: roleFailure.error }, roleFailure.status);
  }
  requirePlatformStaff(req.user!);
}

@Controller('api/platform/estudios')
@UseGuards(AuthGuard)
export class EstudiosController {
  @Get()
  async listEstudios(@Req() req: AuthenticatedRequest) {
    requirePlatformAdmin(req);

    const pool = getPgPool();
    const { rows } = await pool.query<EstudioRow>(
      'SELECT id, name, active, created_at, updated_at FROM estudios ORDER BY name ASC',
    );
    return rows;
  }

  @Post()
  async createEstudio(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    requirePlatformAdmin(req);

    const validation = validateCreateEstudioBody(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const pool = getPgPool();
    const { rows } = await pool.query<EstudioRow>(
      'INSERT INTO estudios (name) VALUES ($1) RETURNING id, name, active, created_at, updated_at',
      [validation.value.name],
    );
    return rows[0];
  }

  /**
   * Disable/enable an estudio — same "deactivate, never delete" posture as
   * tenants.controller.ts's own setActive. Deliberately doesn't cascade
   * into disabling the estudio's own tenants/users: what `estudios.active`
   * should even gate (new logins? existing sessions? nothing yet?) isn't
   * decided, so this only flips the flag for now rather than guessing at
   * enforcement that isn't asked for.
   */
  @Patch(':id')
  async setActive(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    requirePlatformAdmin(req);

    if (!isUuid(id)) {
      throw new HttpException({ error: 'estudio id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.active !== 'boolean') {
      throw new HttpException({ error: 'active is required and must be a boolean' }, HttpStatus.BAD_REQUEST);
    }

    const pool = getPgPool();
    const { rows } = await pool.query<{ id: string; active: boolean }>(
      'UPDATE estudios SET active = $1, updated_at = now() WHERE id = $2 RETURNING id, active',
      [b.active, id],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'estudio not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }

  /**
   * Invites the estudio's FIRST admin — reuses createUser() and the entire
   * existing invite/accept-invite chain (invite-tokens.ts,
   * accept-invite.service.ts, invite-email.ts) completely unchanged; none
   * of those are estudio-aware, and none need to be. The only new thing
   * here is passing the TARGET estudio's id (from the URL param) as
   * createUser()'s estudioId, instead of the caller's own — platform
   * staff's own estudio_id is null, so "the caller's own estudio" doesn't
   * apply to this one route.
   */
  @Post(':id/invite-admin')
  async inviteAdmin(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    requirePlatformAdmin(req);

    if (!isUuid(id)) {
      throw new HttpException({ error: 'estudio id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const validation = validateInviteAdminBody(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const pool = getPgPool();

    try {
      const { invite, ...user } = await createUser(
        pool,
        { email: validation.value.email, role: 'admin', display_name: validation.value.display_name, tenant_ids: [] },
        id,
      );
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpException({ error: 'a user with that email already exists' }, HttpStatus.CONFLICT);
      }
      // estudios.id has no DB default/pre-check here — a well-formed but
      // nonexistent estudio id surfaces as createUser()'s own INSERT
      // violating users.estudio_id's FK, translated to a clean 404
      // instead of an opaque 500 (same "let the caller translate the DB
      // error" posture as isUniqueViolation above).
      if (isForeignKeyViolation(err)) {
        throw new HttpException({ error: 'estudio not found' }, HttpStatus.NOT_FOUND);
      }
      throw err;
    }
  }
}
