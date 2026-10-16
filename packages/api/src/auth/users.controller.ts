/**
 * users.controller.ts — backoffice self-service (admin-only): list/create
 * users and toggle active/inactive. Invite-email sending and the
 * resend-invite endpoint land in PR3 (email/resend-client.ts,
 * invite-email.ts) — this controller only writes the invite token today
 * (see invite-tokens.ts via users.service.ts), it never sends anything.
 *
 * createUser's response deliberately omits the raw invite token — it only
 * ever exists in the DB (hashed) until PR3's email actually ships it to
 * the invited user. Manual verification before PR3 reads the raw token
 * straight from user_invites in Postgres, never from this response.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { isForeignKeyViolation, isUniqueViolation } from '../db/pg-errors';
import { isUuid } from '../tenants/tenants-validation';
import { AuthGuard, type AuthenticatedRequest } from './auth-guard';
import { assertRole } from './role-check';
import { validateCreateUserBody } from './users-validation';
import { createUser, listUsers, setUserActive } from './users.service';

@Controller('api/users')
@UseGuards(AuthGuard)
export class UsersController {
  @Get()
  async listUsers(@Req() req: AuthenticatedRequest) {
    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    return listUsers(getPgPool());
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

    try {
      const { invite, ...user } = await createUser(getPgPool(), validation.value);
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

    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.is_active !== 'boolean') {
      throw new HttpException({ error: 'is_active is required and must be a boolean' }, HttpStatus.BAD_REQUEST);
    }

    const updated = await setUserActive(getPgPool(), id, b.is_active);
    if (!updated) {
      throw new HttpException({ error: 'user not found' }, HttpStatus.NOT_FOUND);
    }
    return updated;
  }
}
