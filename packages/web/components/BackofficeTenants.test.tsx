import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackofficeTenants } from './BackofficeTenants';

const TENANT = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Existing Tenant',
  cuit: '30111111112',
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('BackofficeTenants', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the empty state when there are no tenants', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    render(<BackofficeTenants />);
    expect(await screen.findByText('No hay tenants todavía.')).toBeInTheDocument();
  });

  it('lists tenants with their name and cuit', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [TENANT] }) as unknown as typeof fetch;

    render(<BackofficeTenants />);
    expect(await screen.findByText('Existing Tenant')).toBeInTheDocument();
    expect(screen.getByText('30111111112')).toBeInTheDocument();
  });

  it('opens the create dialog from "Nuevo tenant" and reloads the list after saving', async () => {
    const created = { ...TENANT, id: '22222222-2222-2222-2222-222222222222', name: 'Brand New', cuit: null };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // initial list
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => created }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => [created] }); // reload after save
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackofficeTenants />);
    await screen.findByText('No hay tenants todavía.');

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo tenant' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Brand New');
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Brand New')).toBeInTheDocument();
  });

  it('toggles a tenant active/inactive via ConfirmDialog', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [TENANT] }) // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: TENANT.id, active: false }) }) // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...TENANT, active: false }] }); // reload
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BackofficeTenants />);
    await userEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Desactivar tenant/)).toBeInTheDocument();
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/tenants/${TENANT.id}`),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
  });

  it('opens the edit dialog, prefilled, from a row\'s "Editar" link', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [TENANT] }) as unknown as typeof fetch;

    render(<BackofficeTenants />);
    await screen.findByText('Existing Tenant');

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Editar tenant' })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Existing Tenant')).toBeInTheDocument();
  });
});
