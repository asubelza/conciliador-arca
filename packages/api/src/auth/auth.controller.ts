/**
 * auth.controller.ts — T35/T36 (autenticacion-roles/RF-14).
 * `POST /api/auth/login` was the only unprotected endpoint in this
 * controller — backoffice self-service (invitación por email) adds two
 * more, for the same reason: a not-yet-logged-in user following an email
 * link has no token yet. `GET /api/auth/me` exists as a real, minimal
 * proof the guard works end to end (a frontend can also use it to
 * validate a stored token on load, Fase 3) — not just a throwaway.
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { validateLoginBody } from './auth-validation';
import { login } from './auth.service';
import { validateAcceptInviteBody, validateInviteTokenParam } from './accept-invite-validation';
import { acceptInvite, peekInvite } from './accept-invite.service';
import { AuthGuard, type AuthenticatedRequest } from './auth-guard';

@Controller('api/auth')
export class AuthController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown) {
    const failure = validateLoginBody(body);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const { email, password } = body as { email: string; password: string };
    const pool = getPgPool();
    const result = await login(pool, email, password);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return { user: req.user };
  }

  /** No guard — lets the no-session "set your password" page (SetPasswordPage, PR4) show who the invite is for before the user submits anything. */
  @Get('invite/:token')
  async getInvite(@Param('token') token: unknown) {
    const paramFailure = validateInviteTokenParam(token);
    if (paramFailure) {
      throw new HttpException({ error: paramFailure.error }, paramFailure.status);
    }

    const pool = getPgPool();
    const result = await peekInvite(pool, token as string);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  /** No guard, same reason as login — the invited user has no token yet. Returns a LoginResult so the user is signed in immediately, no separate login step. */
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(@Body() body: unknown) {
    const validation = validateAcceptInviteBody(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const pool = getPgPool();
    const result = await acceptInvite(pool, validation.value.token, validation.value.password);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }
}
