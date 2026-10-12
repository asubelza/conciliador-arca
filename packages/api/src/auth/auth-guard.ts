/**
 * auth-guard.ts — T36 (autenticacion-roles/RF-14): the one thing standing
 * between "no auth at all" (the gap this whole feature closes) and every
 * protected controller. Reads `Authorization: Bearer <jwt>`, verifies it,
 * attaches `req.user` (an `AuthenticatedUser`) for the handler/downstream
 * helpers (assertTenantAccess, Fase 2) to use. No Passport — a single
 * `CanActivate`, same "direct function, no framework layer" instinct as
 * the rest of this codebase.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { verifyToken } from './jwt';
import type { AuthenticatedUser } from './users-types';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  return match ? match[1] : null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException({ error: 'missing Authorization bearer token' });
    }

    const payload = verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException({ error: 'invalid or expired token' });
    }

    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return true;
  }
}
