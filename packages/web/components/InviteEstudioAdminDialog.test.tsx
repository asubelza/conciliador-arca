import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteEstudioAdminDialog } from './InviteEstudioAdminDialog';

const ESTUDIO = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Estudio Target',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const INVITE_RESULT = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'admin@example.com',
  role: 'admin' as const,
  display_name: null,
  is_active: false,
  created_at: '2026-01-01T00:00:00.000Z',
  invite_email_sent: true,
};

describe('InviteEstudioAdminDialog (multi-estudio pivot, PR8)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('invites an admin via POST /api/platform/estudios/:id/invite-admin, scoped to the given estudio', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => INVITE_RESULT });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onClose = jest.fn();
    const onInvited = jest.fn();
    render(<InviteEstudioAdminDialog estudio={ESTUDIO} onClose={onClose} onInvited={onInvited} />);

    expect(screen.getByRole('heading', { name: `Invitar admin de ${ESTUDIO.name}` })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/platform/estudios/${ESTUDIO.id}/invite-admin`),
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ email: 'admin@example.com', display_name: null });
    expect(onInvited).toHaveBeenCalledWith(INVITE_RESULT);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and does not call fetch when the email is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InviteEstudioAdminDialog estudio={ESTUDIO} onClose={jest.fn()} onInvited={jest.fn()} />);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('email es obligatorio');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = jest.fn();
    render(<InviteEstudioAdminDialog estudio={ESTUDIO} onClose={onClose} onInvited={jest.fn()} />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
