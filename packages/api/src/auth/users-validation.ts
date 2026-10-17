/**
 * users-validation.ts — backoffice self-service (admin-only user CRUD):
 * pure request-shape validation for POST /api/users, same dependency-free
 * `{ok:true,value} | {ok:false,failure}` style as tenants-admin-validation.ts.
 *
 * `tenant_ids` is the only field whose validity depends on another field
 * (`role`) — required/non-empty exactly when role is 'cliente', and
 * rejected outright (not silently dropped) for admin/colaborador, per the
 * approved plan's decision 3.
 */
import { isUuid } from '../tenants/tenants-validation';
import type { UserRole } from './users-types';

export interface CreateUserRequestBody {
  email: string;
  role: UserRole;
  display_name: string | null;
  tenant_ids: string[];
}

export type UsersValidationFailure =
  | { code: 'INVALID_EMAIL'; status: 400; error: string }
  | { code: 'INVALID_ROLE'; status: 400; error: string }
  | { code: 'INVALID_DISPLAY_NAME'; status: 400; error: string }
  | { code: 'INVALID_TENANT_IDS'; status: 400; error: string };

export type CreateUserValidationResult =
  | { ok: true; value: CreateUserRequestBody }
  | { ok: false; failure: UsersValidationFailure };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: UserRole[] = ['admin', 'colaborador', 'cliente'];

export function validateCreateUserBody(body: unknown): CreateUserValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  // Normalized the same way users.email's CHECK (email = lower(email))
  // requires (migration 018) — matches createTestUser's own normalization.
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (email.length === 0 || !EMAIL_RE.test(email)) {
    return { ok: false, failure: { code: 'INVALID_EMAIL', status: 400, error: 'email is required and must be a valid email address' } };
  }

  const role = b.role;
  if (typeof role !== 'string' || !ROLES.includes(role as UserRole)) {
    return {
      ok: false,
      failure: { code: 'INVALID_ROLE', status: 400, error: `role is required and must be one of: ${ROLES.join(', ')}` },
    };
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

  const rawTenantIds = b.tenant_ids;
  const tenantIds = Array.isArray(rawTenantIds) ? rawTenantIds : [];
  const tenantIdsAreValidUuids = tenantIds.length > 0 && tenantIds.every((id) => isUuid(id));

  if (role === 'cliente') {
    if (tenantIds.length === 0 || !tenantIdsAreValidUuids) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_TENANT_IDS',
          status: 400,
          error: 'tenant_ids is required and must be a non-empty array of UUIDs when role is "cliente"',
        },
      };
    }
  } else if (rawTenantIds !== undefined && (!Array.isArray(rawTenantIds) || rawTenantIds.length > 0)) {
    return {
      ok: false,
      failure: { code: 'INVALID_TENANT_IDS', status: 400, error: 'tenant_ids must be empty or absent when role is not "cliente"' },
    };
  }

  // Deduplicated here (not just trusted from the caller): a repeated id
  // would otherwise hit user_tenant_access's (user_id, tenant_id) PRIMARY
  // KEY inside createUser()'s transaction and bubble up as a unique
  // violation the controller can't tell apart from a duplicate email.
  const uniqueTenantIds = [...new Set(tenantIds as string[])];

  return { ok: true, value: { email, role: role as UserRole, display_name, tenant_ids: uniqueTenantIds } };
}
