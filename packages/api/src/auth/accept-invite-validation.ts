/**
 * accept-invite-validation.ts — request-shape validation for
 * GET /api/auth/invite/:token and POST /api/auth/accept-invite, same
 * "pure function checked before any DB/bcrypt work" style as
 * auth-validation.ts's validateLoginBody.
 *
 * The token shape (64 lowercase hex chars) comes directly from
 * invite-tokens.ts's TOKEN_BYTES=32 (`randomBytes(32).toString('hex')`) —
 * failing fast on anything else avoids a wasted DB round trip for garbage
 * input.
 *
 * WEAK_PASSWORD is this repo's first password-strength check — every
 * prior account was admin-created with a hash the admin never saw
 * (users-validation.ts's throwaway hash); this is the first path where an
 * end user picks their own password. Checked here, not in
 * accept-invite.service.ts, same layering as every other
 * validation-file/service-file pair in this codebase (e.g.
 * tenants-admin-validation.ts vs. tenants.controller.ts) — the service
 * assumes its input already passed validation.
 */
const TOKEN_RE = /^[0-9a-f]{64}$/;
const MIN_PASSWORD_LENGTH = 8;

export type AcceptInviteValidationFailure =
  | { code: 'INVALID_TOKEN'; status: 400; error: string }
  | { code: 'WEAK_PASSWORD'; status: 400; error: string };

export interface AcceptInviteRequestBody {
  token: string;
  password: string;
}

export type AcceptInviteValidationResult =
  | { ok: true; value: AcceptInviteRequestBody }
  | { ok: false; failure: AcceptInviteValidationFailure };

function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

export function validateInviteTokenParam(value: unknown): AcceptInviteValidationFailure | null {
  if (!isValidToken(value)) {
    return { code: 'INVALID_TOKEN', status: 400, error: 'token must be a valid invite token' };
  }
  return null;
}

export function validateAcceptInviteBody(body: unknown): AcceptInviteValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isValidToken(b.token)) {
    return { ok: false, failure: { code: 'INVALID_TOKEN', status: 400, error: 'token is required and must be a valid invite token' } };
  }

  if (typeof b.password !== 'string' || b.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      failure: { code: 'WEAK_PASSWORD', status: 400, error: `password is required and must be at least ${MIN_PASSWORD_LENGTH} characters` },
    };
  }

  return { ok: true, value: { token: b.token, password: b.password } };
}
