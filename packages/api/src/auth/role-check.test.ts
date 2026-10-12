import { assertRole } from './role-check';
import type { AuthenticatedUser } from './users-types';

function user(role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id: 'u1', email: 'u@example.com', role };
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
