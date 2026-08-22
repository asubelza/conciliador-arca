import { renderHook, act } from '@testing-library/react';
import { clearSession, getSession, setSession, useAuth } from './session';

const USER = { id: 'u1', email: 'a@example.com', role: 'admin' as const, display_name: 'Admin' };

/**
 * T39 (Fase 3, autenticacion-roles): the frontend session store —
 * localStorage persistence, and that `useAuth()` actually re-renders
 * components on login/logout (it's built on useSyncExternalStore
 * specifically so lib/api.ts's handleUnauthorized clearing the session on
 * a 401 propagates to the UI without any extra wiring — see
 * app/page.tsx's `if (!user) return <LoginForm />`).
 */
describe('T39: lib/session', () => {
  afterEach(() => {
    clearSession();
    window.localStorage.clear();
  });

  it('getSession returns null when nothing has logged in', () => {
    expect(getSession()).toBeNull();
  });

  it('setSession stores the token+user and getSession returns them', () => {
    setSession('tok-1', USER);
    expect(getSession()).toEqual({ token: 'tok-1', user: USER });
  });

  it('setSession persists to localStorage', () => {
    setSession('tok-1', USER);
    const raw = window.localStorage.getItem('conciliador_session');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ token: 'tok-1', user: USER });
  });

  it('clearSession removes the session and the localStorage entry', () => {
    setSession('tok-1', USER);
    clearSession();
    expect(getSession()).toBeNull();
    expect(window.localStorage.getItem('conciliador_session')).toBeNull();
  });

  it('useAuth returns null user/token when there is no session', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it('useAuth re-renders with the new user/token after setSession', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toBeNull();

    act(() => {
      setSession('tok-2', USER);
    });

    expect(result.current.user).toEqual(USER);
    expect(result.current.token).toBe('tok-2');
  });

  it('useAuth goes back to null after clearSession (e.g. a 401 auto-logout)', () => {
    setSession('tok-3', USER);
    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toEqual(USER);

    act(() => {
      clearSession();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it('hydrates an existing localStorage session on first access (reload persistence)', () => {
    window.localStorage.setItem('conciliador_session', JSON.stringify({ token: 'tok-4', user: USER }));
    // The module only hydrates from storage once, lazily, on first access
    // (see ensureHydrated's doc) — by this point in the file it's already
    // hydrated from earlier tests, so a fresh module instance is needed to
    // actually exercise that first-access path, the way a real page reload
    // would (a brand new JS context reading whatever's in localStorage).
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('./session');
    expect(fresh.getSession()).toEqual({ token: 'tok-4', user: USER });
  });

  it('ignores malformed localStorage content instead of throwing', () => {
    window.localStorage.setItem('conciliador_session', 'not valid json');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('./session');
    expect(fresh.getSession()).toBeNull();
  });
});
