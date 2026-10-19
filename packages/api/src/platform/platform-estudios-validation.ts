/**
 * platform-estudios-validation.ts — pure request-shape validation for
 * POST /api/platform/estudios and POST /api/platform/estudios/:id/invite-admin,
 * same dependency-free `{ok:true,value} | {ok:false,failure}` style as
 * tenants-admin-validation.ts/users-validation.ts.
 */
const MAX_NAME_LENGTH = 200;

export interface CreateEstudioRequestBody {
  name: string;
}

export type CreateEstudioValidationFailure = { code: 'INVALID_NAME'; status: 400; error: string };

export type CreateEstudioValidationResult =
  | { ok: true; value: CreateEstudioRequestBody }
  | { ok: false; failure: CreateEstudioValidationFailure };

export function validateCreateEstudioBody(body: unknown): CreateEstudioValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      failure: { code: 'INVALID_NAME', status: 400, error: `name is required and must be 1-${MAX_NAME_LENGTH} characters` },
    };
  }

  return { ok: true, value: { name } };
}

/**
 * Deliberately NOT the same shape as CreateUserRequestBody (no `role`/
 * `tenant_ids`): inviting an estudio's FIRST admin always creates an
 * 'admin' with zero tenant_ids — the caller (platform staff) has no say
 * over either, so neither field is even accepted here.
 */
export interface InviteAdminRequestBody {
  email: string;
  display_name: string | null;
}

export type InviteAdminValidationFailure =
  | { code: 'INVALID_EMAIL'; status: 400; error: string }
  | { code: 'INVALID_DISPLAY_NAME'; status: 400; error: string };

export type InviteAdminValidationResult =
  | { ok: true; value: InviteAdminRequestBody }
  | { ok: false; failure: InviteAdminValidationFailure };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInviteAdminBody(body: unknown): InviteAdminValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  // Normalized the same way users.email's CHECK (email = lower(email))
  // requires (migration 018) — same posture as validateCreateUserBody.
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (email.length === 0 || !EMAIL_RE.test(email)) {
    return { ok: false, failure: { code: 'INVALID_EMAIL', status: 400, error: 'email is required and must be a valid email address' } };
  }

  let display_name: string | null = null;
  if (b.display_name !== undefined && b.display_name !== null) {
    if (typeof b.display_name !== 'string' || b.display_name.trim().length === 0) {
      return {
        ok: false,
        failure: { code: 'INVALID_DISPLAY_NAME', status: 400, error: 'display_name must be a non-empty string when present' },
      };
    }
    display_name = b.display_name.trim();
  }

  return { ok: true, value: { email, display_name } };
}
