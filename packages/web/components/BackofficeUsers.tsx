'use client';

import { useCallback, useEffect, useState } from 'react';
import { listUsers, resendInvite, setUserActive, type CreateUserResult, type UserRole, type UserRow } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { SpinnerIcon } from './icons';
import { UserFormDialog } from './UserFormDialog';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  colaborador: 'Colaborador',
  cliente: 'Cliente',
};

/**
 * Backoffice self-service (admin-only): user list + create (email-invite
 * flow, UserFormDialog) + resend-invite + active/inactive toggle. Not wired
 * into app navigation here — BackofficeView composes this alongside
 * BackofficeTenants (PR1).
 */
export function BackofficeUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<UserRow | null>(null);
  const [toggling, setToggling] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleCreated(created: CreateUserResult) {
    setNotice(
      created.invite_email_sent
        ? `Se envió la invitación a ${created.email}.`
        : `Usuario ${created.email} creado, pero no se pudo enviar el email de invitación automáticamente — usá "Reenviar invitación".`,
    );
    void load();
  }

  async function handleToggleConfirm() {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await setUserActive(toggleTarget.id, !toggleTarget.is_active);
      setToggleTarget(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el usuario');
    } finally {
      setToggling(false);
    }
  }

  async function handleResend(user: UserRow) {
    setError(null);
    setResendingId(user.id);
    try {
      const result = await resendInvite(user.id);
      setNotice(
        result.invite_email_sent
          ? `Se reenvió la invitación a ${result.email}.`
          : `No se pudo reenviar el email a ${result.email} automáticamente.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reenviar la invitación');
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Usuarios</h2>
        <button
          type="button"
          onClick={() => setShowCreateDialog(true)}
          className="focus-ring rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nuevo usuario
        </button>
      </div>

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <SpinnerIcon size={16} />
          Cargando…
        </p>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No hay usuarios todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Rol</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{user.display_name ?? user.email}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{ROLE_LABELS[user.role]}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        user.is_active
                          ? 'inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }
                    >
                      {user.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {!user.is_active && (
                        <button
                          type="button"
                          onClick={() => handleResend(user)}
                          disabled={resendingId === user.id}
                          className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-indigo-400"
                        >
                          {resendingId === user.id ? 'Enviando…' : 'Reenviar invitación'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setToggleTarget(user)}
                        className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        {user.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateDialog && <UserFormDialog onClose={() => setShowCreateDialog(false)} onSaved={handleCreated} />}

      {toggleTarget && (
        <ConfirmDialog
          title={toggleTarget.is_active ? 'Desactivar usuario' : 'Activar usuario'}
          text={`¿Estás seguro de que deseas ${toggleTarget.is_active ? 'desactivar' : 'activar'} a ${toggleTarget.email}?`}
          onConfirm={handleToggleConfirm}
          onCancel={() => setToggleTarget(null)}
          isLoading={toggling}
        />
      )}
    </div>
  );
}
