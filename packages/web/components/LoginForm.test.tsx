import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import { getSession, clearSession } from '@/lib/session';

/**
 * T39 (Fase 3, autenticacion-roles): the login screen — app/page.tsx
 * renders this instead of the main app whenever there's no session (see
 * its own `if (!user) return <LoginForm />`).
 */
describe('T39: LoginForm', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('submits email+password to POST /api/auth/login and stores the session on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'tok-abc',
        user: { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@estudio.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'correct-horse-battery-staple');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'ana@estudio.com', password: 'correct-horse-battery-staple' }),
      }),
    );
    expect(getSession()).toEqual({
      token: 'tok-abc',
      user: { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana' },
    });
  });

  it('shows the generic error message on wrong credentials and does not store a session', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'email o contraseña inválidos' }),
    }) as unknown as typeof fetch;

    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@estudio.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'wrong-password');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('email o contraseña inválidos');
    expect(getSession()).toBeNull();
  });
});
