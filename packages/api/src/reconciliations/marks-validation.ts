/**
 * marks-validation.ts — T12 (RF-11): request-shape validation for
 * `POST /api/reconciliations/:jobId/marks` (user marks a voucher `revisado`
 * or `explicado`). Kept dependency-free like upload-validation.ts, for the
 * same reasons — testable in isolation, no NestJS coupling.
 */

export const USER_MARK_CLASSIFICATIONS = ['revisado', 'explicado'] as const;
export type UserMarkClassification = (typeof USER_MARK_CLASSIFICATIONS)[number];

export interface MarkRequestBody {
  composite_key: string;
  classification: UserMarkClassification;
  note: string | null;
  user_id: string | null;
}

export type MarkValidationFailure =
  | { code: 'MISSING_COMPOSITE_KEY'; status: 400; error: string }
  | { code: 'INVALID_CLASSIFICATION'; status: 400; error: string }
  | { code: 'INVALID_USER_ID'; status: 400; error: string };

export type MarkValidationResult = { ok: true; value: MarkRequestBody } | { ok: false; failure: MarkValidationFailure };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `user_id` is optional (there's no auth layer yet — same documented gap as
 * `tenant_id`, see upload-validation.ts), but when provided it must be a
 * UUID: `feedback_loop.user_id` and `audit_trail.user_id` are both UUID
 * columns (010_init_feedback_loop.sql, 006_init_audit_trail.sql), so a
 * non-UUID value would otherwise surface as an opaque Postgres error later.
 */
export function validateMarkRequest(body: unknown): MarkValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.composite_key !== 'string' || b.composite_key.trim() === '') {
    return {
      ok: false,
      failure: { code: 'MISSING_COMPOSITE_KEY', status: 400, error: 'composite_key is required' },
    };
  }

  if (typeof b.classification !== 'string' || !(USER_MARK_CLASSIFICATIONS as readonly string[]).includes(b.classification)) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_CLASSIFICATION',
        status: 400,
        error: `classification is required and must be one of: ${USER_MARK_CLASSIFICATIONS.join(', ')}`,
      },
    };
  }

  if (b.user_id !== undefined && b.user_id !== null && (typeof b.user_id !== 'string' || !UUID_RE.test(b.user_id))) {
    return {
      ok: false,
      failure: { code: 'INVALID_USER_ID', status: 400, error: 'user_id must be a UUID when provided' },
    };
  }

  return {
    ok: true,
    value: {
      composite_key: b.composite_key,
      classification: b.classification as UserMarkClassification,
      note: typeof b.note === 'string' ? b.note : null,
      user_id: typeof b.user_id === 'string' ? b.user_id : null,
    },
  };
}
