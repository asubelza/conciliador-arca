'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createUser, listTenants, type CreateUserResult, type TenantRow, type UserRole } from '@/lib/api';
import { SpinnerIcon, XIcon } from './icons';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'colaborador', label: 'Colaborador' },
  { value: 'cliente', label: 'Cliente' },
];

export interface UserFormDialogProps {
  onClose: () => void;
  onSaved: (created: CreateUserResult) => void;
}

/**
 * Backoffice self-service (admin-only user creation, invitación por email):
 * same focus-trap/Escape shell as TenantFormDialog.tsx/ConfirmDialog.tsx.
 * Create-only — the backend has no "edit email/role/display_name" endpoint,
 * only PATCH :id (active/inactive) and resend-invite, both handled
 * directly from BackofficeUsers.tsx's table rows.
 */
export function UserFormDialog({ onClose, onSaved }: UserFormDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('colaborador');
  const [displayName, setDisplayName] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantsFetchAttempted, setTenantsFetchAttempted] = useState(false);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  // Same focus-management pattern as TenantFormDialog.tsx/ConfirmDialog.tsx.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (emailInputRef.current ?? dialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (savingRef.current) return;
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  // Tenants are only needed for role==='cliente' — fetched lazily the first
  // time that role is selected, not on every dialog open. Gated on
  // `tenantsFetchAttempted` (set once, right away) rather than on
  // `tenantsLoading`/`tenants.length` alone: those both go back to a
  // "fetch again" state after a failed request (loading flips back to
  // false, tenants stays empty), which previously made this effect refire
  // on every failed attempt — an infinite retry loop hammering the API.
  useEffect(() => {
    if (role !== 'cliente' || tenantsFetchAttempted) return;
    setTenantsFetchAttempted(true);
    setTenantsLoading(true);
    setTenantsError(null);
    listTenants()
      .then(setTenants)
      .catch((err) => setTenantsError(err instanceof Error ? err.message : 'No se pudieron cargar los tenants'))
      .finally(() => setTenantsLoading(false));
  }, [role, tenantsFetchAttempted]);

  function toggleTenant(tenantId: string) {
    setSelectedTenantIds((prev) => (prev.includes(tenantId) ? prev.filter((id) => id !== tenantId) : [...prev, tenantId]));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (trimmedEmail.length === 0) {
      setError('El email es obligatorio');
      return;
    }
    if (role === 'cliente' && selectedTenantIds.length === 0) {
      setError('Elegí al menos un tenant para un usuario cliente');
      return;
    }

    setSaving(true);
    try {
      const trimmedDisplayName = displayName.trim();
      const created = await createUser({
        email: trimmedEmail,
        role,
        display_name: trimmedDisplayName === '' ? null : trimmedDisplayName,
        tenant_ids: role === 'cliente' ? selectedTenantIds : [],
      });
      onSaved(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => !saving && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo usuario"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Nuevo usuario</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
            className="focus-ring rounded p-1 text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <XIcon size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="user-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </label>
            <input
              ref={emailInputRef}
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="user-display-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Nombre (opcional)
            </label>
            <input
              id="user-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="user-role" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Rol
            </label>
            <select
              id="user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {role === 'cliente' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Tenants</span>
              {tenantsLoading && (
                <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <SpinnerIcon size={16} />
                  Cargando tenants…
                </p>
              )}
              {tenantsError && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                  {tenantsError}
                </p>
              )}
              {!tenantsLoading && !tenantsError && tenants.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400">No hay tenants todavía — creá uno primero.</p>
              )}
              {!tenantsLoading && tenants.length > 0 && (
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  {tenants.map((tenant) => (
                    <label key={tenant.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={selectedTenantIds.includes(tenant.id)}
                        onChange={() => toggleTenant(tenant.id)}
                        className="focus-ring rounded border-slate-300 dark:border-slate-700"
                      />
                      {tenant.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="focus-ring rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <SpinnerIcon size={16} />}
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
