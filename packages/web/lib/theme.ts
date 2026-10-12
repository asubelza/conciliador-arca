/**
 * lib/theme.ts — rediseño UI/UX (2026-08): store del tema claro/oscuro,
 * misma arquitectura que lib/session.ts (estado a nivel de módulo, sin
 * React Context, `useSyncExternalStore` para que los componentes se
 * re-rendericen al cambiar el tema) para mantener un único patrón en todo
 * el frontend.
 *
 * Persistido en `localStorage` bajo la misma clave que usa el script
 * anti-FOUC inline en app/layout.tsx (que corre antes de la hidratación de
 * React y aplica la clase `dark` en <html> de forma síncrona, evitando el
 * flash de tema claro al cargar en modo oscuro). Este módulo es la única
 * fuente de verdad después de la hidratación: toda lectura/escritura de la
 * clase `dark` en <html> pasa por acá.
 */
'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'conciliador_theme';

let current: Theme = 'light';
let hydrated = false;
const listeners = new Set<() => void>();

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readFromStorage(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage inaccesible (modo privado, etc.) — cae a la preferencia del sistema
  }
  return prefersDark() ? 'dark' : 'light';
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Import time puede ocurrir durante SSR, antes de que exista `window` —
 * la hidratación se difiere hasta el primer acceso real. */
function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  current = readFromStorage();
}

export function getTheme(): Theme {
  ensureHydrated();
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  hydrated = true;
  applyToDocument(theme);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // no bloquea el cambio de tema si localStorage falla
    }
  }
  listeners.forEach((listener) => listener());
}

export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** El snapshot del servidor siempre es 'light' — el valor real solo existe en cliente
 * (el script anti-FOUC ya aplicó la clase correcta a <html> antes de esta hidratación). */
function getServerSnapshot(): Theme {
  return 'light';
}

/** Hook de React: re-renderiza el componente cuando cambia el tema (incluido
 * un cambio disparado por otra pestaña/instancia del ThemeToggle). */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerSnapshot);
  const toggle = useCallback(() => toggleTheme(), []);
  return { theme, toggleTheme: toggle };
}
