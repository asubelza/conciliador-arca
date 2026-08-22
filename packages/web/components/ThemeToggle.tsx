/**
 * components/ThemeToggle.tsx — rediseño UI/UX (2026-08): botón para
 * alternar claro/oscuro, montado en el header de la vista autenticada
 * (app/page.tsx) y en la pantalla de login. Usa lib/theme.ts como única
 * fuente de verdad; no depende de que el padre le pase estado.
 */
'use client';

import { useTheme } from '../lib/theme';
import { MoonIcon, SunIcon } from './icons';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
