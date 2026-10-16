import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetPasswordPage } from './SetPasswordPage';
import { getSession, clearSession } from '@/lib/session';

const TOKEN = 'a'.repeat(64);

describe('SetPasswordPage (backoffice self-service, invitación por email — no session)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('peeks the invite on mount and shows who it is for', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: 'Invitee' }) }) as unknown as typeof fetch;

    render(<SetPasswordPage token={TOKEN} onAccepted={jest.fn()} />);
    expect(await screen.findByText(/Invitee/)).toBeInTheDocument();
  });

  it('falls back to the email when display_name is null', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) }) as unknown as typeof fetch;

    render(<SetPasswordPage token={TOKEN} onAccepted={jest.fn()} />);
    expect(await screen.findByText(/invitee@example.com/)).toBeInTheDocument();
  });

  it('shows an error state (no form) for an invalid/expired/already-used invite', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 410, json: async () => ({ error: 'la invitación venció' }) }) as unknown as typeof fetch;

    render(<SetPasswordPage token={TOKEN} onAccepted={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('venció');
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
  });

  it('rejects a password shorter than 8 characters without calling acceptInvite', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SetPasswordPage token={TOKEN} onAccepted={jest.fn()} />);
    await screen.findByLabelText('Contraseña');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'short');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'short');

    const callsBeforeSubmit = fetchMock.mock.calls.length;
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Activar cuenta' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('al menos 8 caracteres');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSubmit);
  });

  it('rejects mismatched password/confirmation without calling acceptInvite', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SetPasswordPage token={TOKEN} onAccepted={jest.fn()} />);
    await screen.findByLabelText('Contraseña');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'first-password');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'second-password');

    const callsBeforeSubmit = fetchMock.mock.calls.length;
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Activar cuenta' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSubmit);
  });

  it('accepts the invite, sets the session, strips ?invite_token from the URL, and calls onAccepted', async () => {
    window.history.pushState({}, '', `/?invite_token=${TOKEN}`);
    const loginResult = { token: 'session-jwt', user: { id: 'u1', email: 'invitee@example.com', role: 'cliente', display_name: null } };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) }) // peekInvite
      .mockResolvedValueOnce({ ok: true, json: async () => loginResult }); // acceptInvite
    global.fetch = fetchMock as unknown as typeof fetch;

    const onAccepted = jest.fn();
    render(<SetPasswordPage token={TOKEN} onAccepted={onAccepted} />);
    await screen.findByLabelText('Contraseña');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'a-brand-new-password');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'a-brand-new-password');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Activar cuenta' }));
    });

    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(getSession()).toEqual({ token: 'session-jwt', user: loginResult.user });
    expect(window.location.search).toBe('');
  });

  it('surfaces a 410 (expired/already-used) accept-invite error without setting a session', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) }) // peekInvite
      .mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({ error: 'la invitación ya fue utilizada' }) }); // acceptInvite
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SetPasswordPage token={TOKEN} onAccepted={jest.fn()} />);
    await screen.findByLabelText('Contraseña');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'a-brand-new-password');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'a-brand-new-password');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Activar cuenta' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue utilizada');
    expect(getSession()).toBeNull();
  });
});
