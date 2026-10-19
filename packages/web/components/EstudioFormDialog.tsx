'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createEstudio, type EstudioRow } from '@/lib/api';
import { SpinnerIcon, XIcon } from './icons';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface EstudioFormDialogProps {
  onClose: () => void;
  onSaved: (estudio: EstudioRow) => void;
}

/**
 * Platform self-service (admin-only estudio creation, multi-estudio pivot
 * PR8): same focus-trap/Escape shell as TenantFormDialog.tsx/
 * UserFormDialog.tsx. Create-only — the backend has no "edit name" endpoint
 * for estudios, only PATCH :id (active/inactive), handled directly from
 * PlatformEstudios.tsx's table rows, same split as tenants/users.
 */
export function EstudioFormDialog({ onClose, onSaved }: EstudioFormDialogProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  // Same focus-management pattern as TenantFormDialog.tsx/UserFormDialog.tsx.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (nameInputRef.current ?? dialogRef.current)?.focus();

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('El nombre es obligatorio');
      return;
    }

    setSaving(true);
    try {
      const saved = await createEstudio(trimmedName);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el estudio');
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
        aria-label="Nuevo estudio"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Nuevo estudio</h2>
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
            <label htmlFor="estudio-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Nombre
            </label>
            <input
              ref={nameInputRef}
              id="estudio-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

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
