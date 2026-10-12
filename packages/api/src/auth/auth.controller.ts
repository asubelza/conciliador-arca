/**
 * auth.controller.ts — T35/T36 (autenticacion-roles/RF-14).
 * `POST /api/auth/login` is deliberately the only unprotected endpoint in
 * this controller (no @UseGuards) — everything else in the app will
 * require the token this issues (Fase 2). `GET /api/auth/me` exists as a
 * real, minimal proof the guard works end to end (a frontend can also use
 * it to validate a stored token on load, Fase 3) — not just a throwaway.
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { validateLoginBody } from './auth-validation';
import { login } from './auth.service';
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
}
