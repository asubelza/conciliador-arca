/**
 * lib/session.ts — T39 (Fase 3, autenticacion-roles/RF-14): the frontend's
 * session store. Framework-free module state (not a React Context) so
 * lib/api.ts — a plain fetch wrapper, not a component — can read the
 * current token without needing a hook; components read it via `useAuth()`
 * below, built on `useSyncExternalStore` so they still re-render whenever
 * the session changes (login, logout, or a 401 auto-logout from api.ts).
 *
 * Persisted to `localStorage` (not just in-memory) so a reload/new tab
 * doesn't force a re-login — architecture.md's documented tradeoff: no
 * cookies (avoids the cross-origin cookie complexity of a separate
 * frontend/API origin), which means an XSS on this origin could read the
 * token either way, in memory or in storage. Accepted for this phase
 * (internal tool, single estudio), same posture as the JWT's stateless
 * AuthGuard (see auth-guard.ts's module doc).
 */
'use client';

import { useSyncExternalStore } from 'react';

export type UserRole = 'admin' | 'colaborador' | 'cliente';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  display_name?: string | null;
}

interface StoredSession {
  token: string;
  user: SessionUser;
}

const STORAGE_KEY = 'conciliador_session';

let current: StoredSession | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function readFromStorage(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.user) {
      return parsed as StoredSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Import time can happen during SSR, before `window` exists — hydration is
 * deferred to first access instead of running at module load.
 */
function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  current = readFromStorage();
}

export function getSession(): StoredSession | null {
  ensureHydrated();
  return current;
}

export function setSession(token: string, user: SessionUser): void {
  current = { token, user };
  hydrated = true;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
  listeners.forEach((listener) => listener());
}

export function clearSession(): void {
  current = null;
  hydrated = true;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server snapshot is always "no session" — the real value only exists client-side. */
function getServerSnapshot(): StoredSession | null {
  return null;
}

/** React hook: re-renders the component whenever login/logout/401-auto-logout happens. */
export function useAuth(): { user: SessionUser | null; token: string | null } {
  const session = useSyncExternalStore(subscribe, getSession, getServerSnapshot);
  return { user: session?.user ?? null, token: session?.token ?? null };
}
