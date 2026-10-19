/**
 * users.controller.ts — backoffice self-service (admin-only): list/create
 * users, toggle active/inactive, and resend an invite. Actually sending
 * the email happens in users.service.ts (createUser/resendInvite) via
 * invite-email.ts/smtp-client.ts.
 *
 * createUser/resendInvite's responses deliberately omit the raw invite
 * token — it only ever exists in the DB (hashed); the admin only sees
 * `invite_email_sent` (whether the SMTP send succeeded), never the token
 * itself. Manual verification without SMTP configured reads the raw
 * token straight from user_invites in Postgres, never from these
 * responses.
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { isForeignKeyViolation, isUniqueViolation } from '../db/pg-errors';
import { isUuid } from '../tenants/tenants-validation';
import { AuthGuard, type AuthenticatedRequest } from './auth-guard';
import { assertRole } from './role-check';
import { requireEstudioId } from './estudio-access';
import { validateCreateUserBody } from './users-validation';
import { createUser, listUsers, resendInvite, setUserActive } from './users.service';

@Controller('api/users')
@UseGuards(AuthGuard)
export class UsersController {
  @Get()
  async listUsers(@Req() req: AuthenticatedRequest) {
    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    return listUsers(getPgPool(), estudioId);
  }

  @Post()
  async createUser(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const validation = validateCreateUserBody(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    try {
      const { invite, ...user } = await createUser(getPgPool(), validation.value, estudioId);
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpException({ error: 'a user with that email already exists' }, HttpStatus.CONFLICT);
      }
      if (isForeignKeyViolation(err)) {
        throw new HttpException({ error: 'one of the given tenant_ids does not exist' }, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }
  }

  @Patch(':id')
  async setActive(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!isUuid(id)) {
      throw new HttpException({ error: 'user id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.is_active !== 'boolean') {
      throw new HttpException({ error: 'is_active is required and must be a boolean' }, HttpStatus.BAD_REQUEST);
    }

    const updated = await setUserActive(getPgPool(), id, b.is_active, estudioId);
    if (updated === 'NOT_FOUND') {
      throw new HttpException({ error: 'user not found' }, HttpStatus.NOT_FOUND);
    }
    if (updated === 'NEVER_ONBOARDED') {
      throw new HttpException(
        { error: 'cannot activate a user who has not accepted their invite yet — resend the invite instead' },
        HttpStatus.CONFLICT,
      );
    }
    return updated;
  }

  /** Admin-only: mints a fresh invite token (invalidating any still-valid one) and sends it — refused for an already-active user. */
  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.OK)
  async resendInvite(@Param('id') id: unknown, @Req() req: AuthenticatedRequest) {
    if (!isUuid(id)) {
      throw new HttpException({ error: 'user id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    const result = await resendInvite(getPgPool(), id as string, estudioId);
    if (result === 'NOT_FOUND') {
      throw new HttpException({ error: 'user not found' }, HttpStatus.NOT_FOUND);
    }
    if (result === 'ALREADY_ACTIVE') {
      throw new HttpException({ error: 'user is already active' }, HttpStatus.CONFLICT);
    }
    return result;
  }
}
