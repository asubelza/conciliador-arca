import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformEstudios } from './PlatformEstudios';

const ESTUDIO = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Estudio Existente',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('PlatformEstudios (multi-estudio pivot, PR8)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the empty state when there are no estudios', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    expect(await screen.findByText('No hay estudios todavía.')).toBeInTheDocument();
  });

  it('lists estudios with their name and active status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [ESTUDIO] }) as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    expect(await screen.findByText('Estudio Existente')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('opens the create dialog from "Nuevo estudio" and reloads the list after saving', async () => {
    const created = { ...ESTUDIO, id: '22222222-2222-2222-2222-222222222222', name: 'Brand New Estudio' };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // initial list
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => created }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => [created] }); // reload after save
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    await screen.findByText('No hay estudios todavía.');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo estudio' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Brand New Estudio');
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Brand New Estudio')).toBeInTheDocument();
  });

  it('toggles an estudio active/inactive via ConfirmDialog', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [ESTUDIO] }) // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: ESTUDIO.id, active: false }) }) // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...ESTUDIO, active: false }] }); // reload
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Desactivar estudio/)).toBeInTheDocument();
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/platform/estudios/${ESTUDIO.id}`),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
  });

  it('opens the invite-admin dialog from a row\'s "Invitar admin" link, scoped to that estudio', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [ESTUDIO] }) as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    await screen.findByText('Estudio Existente');

    await userEvent.click(screen.getByRole('button', { name: 'Invitar admin' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: `Invitar admin de ${ESTUDIO.name}` })).toBeInTheDocument();
  });

  it('shows a success notice after inviting an admin', async () => {
    const inviteResult = {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'nuevo-admin@example.com',
      role: 'admin',
      display_name: null,
      is_active: false,
      created_at: '2026-01-01T00:00:00.000Z',
      invite_email_sent: true,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [ESTUDIO] }) // initial list
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => inviteResult }); // POST invite-admin
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Invitar admin' }));

    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'nuevo-admin@example.com');
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Invitar' }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Se envió la invitación a nuevo-admin@example.com.')).toBeInTheDocument();
  });

  it('hides every write control (Nuevo estudio, Invitar admin, Desactivar) for colaborador — reads are open, writes are admin-only server-side', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [ESTUDIO] }) as unknown as typeof fetch;

    render(<PlatformEstudios userRole="colaborador" />);
    await screen.findByText('Estudio Existente');

    expect(screen.queryByRole('button', { name: 'Nuevo estudio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invitar admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('a slow initial load resolving AFTER a faster create-triggered reload does not overwrite the newer list (code review: request-sequencing guard)', async () => {
    const created = { ...ESTUDIO, id: '22222222-2222-2222-2222-222222222222', name: 'Created While Slow Load Pending' };
    let resolveSlowInitialLoad!: (value: { ok: true; json: () => Promise<typeof ESTUDIO[]> }) => void;
    const slowInitialLoad = new Promise((resolve) => {
      resolveSlowInitialLoad = resolve;
    });

    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(slowInitialLoad) // initial GET — deliberately left pending
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => created }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => [created] }); // reload after create — resolves first
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo estudio' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Created While Slow Load Pending');
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByText('Created While Slow Load Pending')).toBeInTheDocument();

    // The slow initial GET finally resolves, with data from BEFORE the
    // create — without the sequencing guard this would overwrite the list
    // back to empty.
    await act(async () => {
      resolveSlowInitialLoad({ ok: true, json: async () => [] });
    });

    expect(screen.getByText('Created While Slow Load Pending')).toBeInTheDocument();
    expect(screen.queryByText('No hay estudios todavía.')).not.toBeInTheDocument();
  });

  it('shows an error message when the list fails to load', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) as unknown as typeof fetch;

    render(<PlatformEstudios userRole="admin" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
