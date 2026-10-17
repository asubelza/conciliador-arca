import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantFormDialog } from './TenantFormDialog';

const TENANT = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Existing Tenant',
  cuit: '30111111112',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('TenantFormDialog (backoffice self-service)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a tenant via POST /api/tenants and calls onSaved + onClose', async () => {
    const created = { ...TENANT, id: '22222222-2222-2222-2222-222222222222', name: 'New Tenant', cuit: null };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => created });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(<TenantFormDialog onClose={onClose} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: 'Nuevo tenant' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nombre'), 'New Tenant');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/tenants'), expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ name: 'New Tenant', cuit: null });
    expect(onSaved).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalled();
  });

  it('edits a tenant via PUT /api/tenants/:id, prefilled with its current values', async () => {
    const updated = { ...TENANT, name: 'Renamed' };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => updated });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onSaved = jest.fn();
    render(<TenantFormDialog tenant={TENANT} onClose={jest.fn()} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: 'Editar tenant' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Existing Tenant')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30111111112')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Nombre');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/tenants/${TENANT.id}`),
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('shows an error and does not call fetch when the name is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TenantFormDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('nombre es obligatorio');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = jest.fn();
    render(<TenantFormDialog onClose={onClose} onSaved={jest.fn()} />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
