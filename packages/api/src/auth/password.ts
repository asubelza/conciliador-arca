/**
 * password.ts — T34 (autenticacion-roles/RF-14): password hashing, isolated
 * behind two functions so the rest of the codebase never touches bcryptjs
 * directly (same "thin wrapper" instinct as db/pg-pool.ts).
 */
import bcrypt from 'bcryptjs';

/** Cost factor 12 — bcryptjs's own recommended default for 2024+ hardware. */
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
