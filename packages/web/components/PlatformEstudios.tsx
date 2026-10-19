'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listEstudios, setEstudioActive, type EstudioRow, type InviteAdminResult, type UserRole } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { EstudioFormDialog } from './EstudioFormDialog';
import { InviteEstudioAdminDialog } from './InviteEstudioAdminDialog';
import { SpinnerIcon } from './icons';

export interface PlatformEstudiosProps {
  /**
   * Multi-estudio pivot (PR8): read (list) is open to platform admin AND
   * colaborador alike, but every write (create/disable-enable/invite-admin)
   * is admin-only server-side (estudios.controller.ts's requirePlatformWrite)
   * — this hides those controls for colaborador instead of letting them
   * click through to a 403 the backend would reject anyway.
   */
  userRole: UserRole;
}

/**
 * Platform self-service (multi-estudio pivot, PR6/PR8): estudio list +
 * create + disable/enable + invite-admin. Same shape as
 * BackofficeTenants.tsx, one level up — this manages the estudios
 * THEMSELVES, not what's inside one. Composed by PlatformView, the
 * platform-staff counterpart to BackofficeView.
 */
export function PlatformEstudios({ userRole }: PlatformEstudiosProps) {
  const canWrite = userRole === 'admin';

  const [estudios, setEstudios] = useState<EstudioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<EstudioRow | null>(null);
  const [toggleTarget, setToggleTarget] = useState<EstudioRow | null>(null);
  const [toggling, setToggling] = useState(false);
  // Code review: load() can be called again (create/toggle) before a
  // slower in-flight call resolves — without this, that earlier call's
  // stale response can land AFTER the newer one and silently overwrite it
  // with pre-mutation data. Each call stamps its own request, and only the
  // most recent one is allowed to commit its result.
  const latestRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await listEstudios();
      if (requestId === latestRequestRef.current) {
        setEstudios(rows);
      }
    } catch (err) {
      if (requestId === latestRequestRef.current) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los estudios');
      }
    } finally {
      if (requestId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleCreated() {
    void load();
  }

  function handleInvited(result: InviteAdminResult) {
    setInviteTarget(null);
    setNotice(
      result.invite_email_sent
        ? `Se envió la invitación a ${result.email}.`
        : `Admin ${result.email} creado, pero no se pudo enviar el email de invitación automáticamente.`,
    );
  }

  async function handleToggleConfirm() {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await setEstudioActive(toggleTarget.id, !toggleTarget.active);
      setToggleTarget(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el estudio');
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Estudios</h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="focus-ring rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Nuevo estudio
          </button>
        )}
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
      ) : estudios.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No hay estudios todavía.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {estudios.map((estudio) => (
                <tr key={estudio.id}>
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-200">{estudio.name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        estudio.active
                          ? 'inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }
                    >
                      {estudio.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canWrite && (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setInviteTarget(estudio)}
                          className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                        >
                          Invitar admin
                        </button>
                        <button
                          type="button"
                          onClick={() => setToggleTarget(estudio)}
                          className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                          {estudio.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateDialog && <EstudioFormDialog onClose={() => setShowCreateDialog(false)} onSaved={handleCreated} />}

      {inviteTarget && (
        <InviteEstudioAdminDialog estudio={inviteTarget} onClose={() => setInviteTarget(null)} onInvited={handleInvited} />
      )}

      {toggleTarget && (
        <ConfirmDialog
          title={toggleTarget.active ? 'Desactivar estudio' : 'Activar estudio'}
          text={`¿Estás seguro de que deseas ${toggleTarget.active ? 'desactivar' : 'activar'} a ${toggleTarget.name}?`}
          onConfirm={handleToggleConfirm}
          onCancel={() => setToggleTarget(null)}
          isLoading={toggling}
        />
      )}
    </div>
  );
}
