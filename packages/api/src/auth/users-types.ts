/** T33/T34 (autenticacion-roles/RF-14): shared user/role types. */
export type UserRole = 'admin' | 'colaborador' | 'cliente';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string | null;
  is_active: boolean;
  estudio_id: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  estudio_id: string | null;
}
