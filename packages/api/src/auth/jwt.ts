/**
 * jwt.ts — T34 (autenticacion-roles/RF-14): sign/verify the session token.
 * Plain `jsonwebtoken`, no Passport/NestJS-auth-module ceremony — same
 * "direct function, no framework layer" style as the rest of this codebase
 * (see tenants.controller.ts's own module doc).
 */
import jwt from 'jsonwebtoken';
import type { UserRole } from './users-types';

export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
  email: string;
  estudio_id: string | null; // multi-estudio pivot: null means platform-level staff
}

const EXPIRES_IN = '12h';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: EXPIRES_IN });
}

/** Returns the decoded payload, or null for any invalid/expired/malformed token — callers never need to distinguish why. */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded !== 'object' || decoded === null) return null;
    const { sub, role, email, estudio_id } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof role !== 'string' || typeof email !== 'string') return null;
    if (role !== 'admin' && role !== 'colaborador' && role !== 'cliente') return null;
    if (typeof estudio_id !== 'string' && estudio_id !== null) return null;
    return { sub, role, email, estudio_id };
  } catch {
    return null;
  }
}
