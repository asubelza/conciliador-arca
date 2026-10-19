import { assertRole } from './role-check';
import type { AuthenticatedUser } from './users-types';

function user(role: AuthenticatedUser['role']): AuthenticatedUser {
  // estudio_id is irrelevant here — assertRole is a deliberately separate,
  // orthogonal axis from estudio scoping (see tenant-access.ts).
  return { id: 'u1', email: 'u@example.com', role, estudio_id: 'estudio-1' };
}

describe('T37: assertRole', () => {
  it('passes when the user role is in the allowed list', () => {
    expect(assertRole(user('admin'), ['admin', 'colaborador'])).toBeUndefined();
    expect(assertRole(user('colaborador'), ['admin', 'colaborador'])).toBeUndefined();
  });

  it('rejects with 403 when the user role is not in the allowed list', () => {
    expect(assertRole(user('cliente'), ['admin', 'colaborador'])).toEqual({
      status: 403,
      error: 'tu rol no tiene permiso para esta acción',
    });
  });

  it('rejects admin when the allowed list only names other roles', () => {
    expect(assertRole(user('admin'), ['cliente'])).toEqual({
      status: 403,
      error: 'tu rol no tiene permiso para esta acción',
    });
  });
});
