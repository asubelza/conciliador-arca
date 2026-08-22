import { renderHook, act } from '@testing-library/react';
import { getTheme, setTheme, toggleTheme, useTheme } from './theme';

/**
 * Rediseño UI/UX (2026-08): store del tema claro/oscuro — misma cobertura
 * que lib/session.test.ts (persistencia en localStorage, re-render vía
 * useSyncExternalStore, hidratación perezosa en el primer acceso), más la
 * responsabilidad extra de este módulo: aplicar/quitar la clase `dark` en
 * <html>.
 */
describe('rediseño UI/UX: lib/theme', () => {
  afterEach(() => {
    setTheme('light');
    window.localStorage.clear();
  });

  it('defaults to light when nothing is stored and there is no matchMedia support', () => {
    expect(getTheme()).toBe('light');
  });

  it('setTheme("dark") adds the dark class to <html> and persists it', () => {
    setTheme('dark');
    expect(getTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('conciliador_theme')).toBe('dark');
  });

  it('setTheme("light") removes the dark class and persists it', () => {
    setTheme('dark');
    setTheme('light');
    expect(getTheme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('conciliador_theme')).toBe('light');
  });

  it('toggleTheme flips between light and dark', () => {
    setTheme('light');
    toggleTheme();
    expect(getTheme()).toBe('dark');
    toggleTheme();
    expect(getTheme()).toBe('light');
  });

  it('useTheme re-renders and exposes a stable toggle callback', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('hydrates an existing localStorage preference on first access (reload persistence)', () => {
    window.localStorage.setItem('conciliador_theme', 'dark');
    // Same reasoning as lib/session.test.ts's equivalent case: hydration is
    // lazy and only runs once per module instance, so a fresh require is
    // needed to actually exercise the first-access path like a real reload.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('./theme');
    expect(fresh.getTheme()).toBe('dark');
  });

  it('ignores an invalid stored value and falls back to the system/default preference', () => {
    window.localStorage.setItem('conciliador_theme', 'not-a-theme');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('./theme');
    expect(fresh.getTheme()).toBe('light');
  });
});
