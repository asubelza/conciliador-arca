'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { acceptInvite, peekInvite } from '@/lib/api';
import { setSession } from '@/lib/session';
import { ThemeToggle } from './ThemeToggle';
import { BuildingIcon, SpinnerIcon } from './icons';

const MIN_PASSWORD_LENGTH = 8;

export interface SetPasswordPageProps {
  token: string;
  /** Called once the invite is accepted and the session is set — lets app/page.tsx drop `?invite_token` from its own state and fall through to the normal app. */
  onAccepted: () => void;
}

type PeekState =
  | { status: 'loading' }
  | { status: 'ready'; email: string; display_name: string | null }
  | { status: 'error'; message: string };

/**
 * Backoffice self-service (invitación por email): no-session page reached
 * via the `?invite_token=` link invite-email.ts sends. app/page.tsx renders
 * this BEFORE its `if (!user)` login gate — wins even over an existing
 * session (approved plan, decision 5).
 *
 * `peekInvite` on mount only looks up who the invite is for (never consumes
 * it) — real consumption happens once in `acceptInvite`, on submit.
 */
export function SetPasswordPage({ token, onAccepted }: SetPasswordPageProps) {
  const [peek, setPeek] = useState<PeekState>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    peekInvite(token)
      .then((result) => {
        if (!cancelled) setPeek({ status: 'ready', email: result.email, display_name: result.display_name });
      })
      .catch((err) => {
        if (!cancelled) setPeek({ status: 'error', message: err instanceof Error ? err.message : 'No se pudo validar la invitación' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Las contraseñas no coinciden');
      return;
    }

    setSubmitting(true);
    try {
      const { token: sessionToken, user } = await acceptInvite(token, password);
      setSession(sessionToken, user);
      window.history.replaceState(null, '', window.location.pathname);
      onAccepted();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo activar la cuenta');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-16 dark:from-slate-950 dark:to-slate-900">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <BuildingIcon size={24} />
          </span>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Activar tu cuenta</h1>
        </div>

        {peek.status === 'loading' && (
          <p className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <SpinnerIcon size={16} />
            Validando invitación…
          </p>
        )}

        {peek.status === 'error' && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {peek.message}
          </p>
        )}

        {peek.status === 'ready' && (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Invitación para{' '}
              <span className="font-medium text-slate-700 dark:text-slate-300">{peek.display_name ?? peek.email}</span>. Elegí tu
              contraseña para activar la cuenta.
            </p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="set-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Contraseña
              </label>
              <input
                id="set-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="set-password-confirm" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Confirmar contraseña
              </label>
              <input
                id="set-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            {formError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <SpinnerIcon size={16} />}
              {submitting ? 'Activando…' : 'Activar cuenta'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
