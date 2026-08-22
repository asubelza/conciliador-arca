'use client';

import { useState, type FormEvent } from 'react';
import { login } from '@/lib/api';
import { setSession } from '@/lib/session';

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
    <main className="max-w-sm mx-auto p-8 flex flex-col gap-6 mt-16">
      <div>
        <h1 className="text-2xl font-semibold">Conciliador Inteligente de Comprobantes</h1>
        <p className="text-sm text-gray-600">Ingresá con tu email y contraseña.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="login-email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border rounded px-3 py-2"
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="login-password" className="text-sm font-medium">
            Contraseña
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border rounded px-3 py-2"
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-red-600 text-sm">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
