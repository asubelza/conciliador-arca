import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackofficeUsers } from './BackofficeUsers';

const INACTIVE_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'inactive@example.com',
  role: 'colaborador',
  display_name: null,
  is_active: false,
  created_at: '2026-01-01T00:00:00.000Z',
  tenant_ids: [],
};

const ACTIVE_USER = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'active@example.com',
  role: 'admin',
  display_name: 'Admin Activo',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  tenant_ids: [],
};

describe('BackofficeUsers (backoffice self-service, invitación por email)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the empty state when there are no users', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<BackofficeUsers />);
    expect(await screen.findByText('No hay usuarios todavía.')).toBeInTheDocument();
  });

  it('lists users with email/role/estado, "Reenviar invitación" only for inactive users', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [INACTIVE_USER, ACTIVE_USER] }) as unknown as typeof fetch;

    render(<BackofficeUsers />);
    expect(await screen.findByText('inactive@example.com')).toBeInTheDocument();
    expect(screen.getByText('Admin Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const inactiveRow = rows.find((r) => within(r).queryByText('inactive@example.com'));
    const activeRow = rows.find((r) => within(r).queryByText('Admin Activo'));
    expect(within(inactiveRow!).getByRole('button', { name: 'Reenviar invitación' })).toBeInTheDocument();
    expect(within(activeRow!).queryByRole('button', { name: 'Reenviar invitación' })).not.toBeInTheDocument();
  });

  it('opens the create dialog from "Nuevo usuario" and reloads the list after saving', async () => {
    const created = { ...INACTIVE_USER, id: '33333333-3333-3333-3333-333333333333', email: 'brand-new@example.com', invite_email_sent: true };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // initial list
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => created }) // POST /api/users
      .mockResolvedValueOnce({ ok: true, json: async () => [created] }); // reload after save
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackofficeUsers />);
    await screen.findByText('No hay usuarios todavía.');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'brand-new@example.com');
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('brand-new@example.com')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Se envió la invitación');
  });

  it('shows a graceful notice (not an error) when invite_email_sent is false', async () => {
    const created = { ...INACTIVE_USER, email: 'no-email@example.com', invite_email_sent: false };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => created })
      .mockResolvedValueOnce({ ok: true, json: async () => [created] });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackofficeUsers />);
    await screen.findByText('No hay usuarios todavía.');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Email'), 'no-email@example.com');
    await act(async () => {
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByRole('status')).toHaveTextContent('no se pudo enviar el email');
  });

  it('resends an invite from a row and shows the result as a notice', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [INACTIVE_USER] }) // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: INACTIVE_USER.email, invite_email_sent: true }) }); // POST resend-invite
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackofficeUsers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reenviar invitación' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Se reenvió la invitación');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/users/${INACTIVE_USER.id}/resend-invite`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('toggles a user active/inactive via ConfirmDialog', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [ACTIVE_USER] }) // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: ACTIVE_USER.id, is_active: false }) }) // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...ACTIVE_USER, is_active: false }] }); // reload
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackofficeUsers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Desactivar usuario/)).toBeInTheDocument();
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/users/${ACTIVE_USER.id}`),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ is_active: false }) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
