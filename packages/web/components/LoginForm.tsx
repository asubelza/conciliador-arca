'use client';

import { useState, type FormEvent } from 'react';
import { login } from '@/lib/api';
import { setSession } from '@/lib/session';
import { ThemeToggle } from './ThemeToggle';
import { BuildingIcon, SpinnerIcon } from './icons';

/**
 * T39 (Fase 3, autenticacion-roles/RF-14): email+password login screen —
 * the only thing standing between "app shows nothing until you're
 * authenticated" (app/page.tsx renders this instead of the main app when
 * there's no session) and the now fully-protected backend (Fase 2). No
 * public sign-up: accounts are created manually (architecture.md — the
 * client chose "yo las creo manualmente por vos al terminar"), so this
 * form is deliberately just the two fields, no "crear cuenta" link.
 */
export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await login(email.trim(), password);
      setSession(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
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
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Conciliador Inteligente de Comprobantes
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ingresá con tu email y contraseña.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Contraseña
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              required
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <SpinnerIcon size={16} />}
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </main>
  );
}
