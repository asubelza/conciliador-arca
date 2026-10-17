import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserFormDialog } from './UserFormDialog';

const TENANT = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Existing Tenant',
  cuit: '30111111112',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const CREATED_ADMIN = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'new-admin@example.com',
  role: 'admin',
  display_name: null,
  is_active: false,
  created_at: '2026-01-01T00:00:00.000Z',
  invite_email_sent: false,
};

describe('UserFormDialog (backoffice self-service, invitación por email)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an admin via POST /api/users (no tenant checklist shown) and calls onSaved + onClose', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => CREATED_ADMIN });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(<UserFormDialog onClose={onClose} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: 'Nuevo usuario' })).toBeInTheDocument();
    expect(screen.queryByText('Tenants')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Email'), 'new-admin@example.com');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/users'), expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ email: 'new-admin@example.com', role: 'colaborador', display_name: null, tenant_ids: [] });
    expect(onSaved).toHaveBeenCalledWith(CREATED_ADMIN);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a tenant checklist only for role=cliente, fetched from listTenants()', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [TENANT] });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UserFormDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(screen.queryByText('Tenants')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'cliente');

    expect(await screen.findByText('Existing Tenant')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/tenants'), expect.anything());
  });

  it('shows the error and fetches listTenants() exactly once when it fails, instead of retrying in a loop', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UserFormDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'cliente');

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    // Regression: a bug made the tenants-loading effect refire on every
    // failed attempt (its guard depended on `tenantsLoading`, which flips
    // back to false after a failure, re-satisfying the guard and
    // refetching forever). Give any such loop a chance to run before
    // asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects submitting role=cliente with no tenant selected, without calling fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [TENANT] });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UserFormDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('Email'), 'cliente@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'cliente');
    await screen.findByText('Existing Tenant');

    const callsBeforeSubmit = fetchMock.mock.calls.length;
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Elegí al menos un tenant');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSubmit);
  });

  it('creates a cliente with the checked tenant_ids', async () => {
    const createdCliente = { ...CREATED_ADMIN, id: '33333333-3333-3333-3333-333333333333', role: 'cliente', email: 'cliente@example.com' };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [TENANT] }) // listTenants (on role switch)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => createdCliente }); // POST /api/users
    global.fetch = fetchMock as unknown as typeof fetch;

    const onSaved = jest.fn();
    render(<UserFormDialog onClose={jest.fn()} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Email'), 'cliente@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'cliente');
    await userEvent.click(await screen.findByLabelText('Existing Tenant'));

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(createdCliente));
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    const body = JSON.parse(postCall![1].body as string);
    expect(body).toEqual({ email: 'cliente@example.com', role: 'cliente', display_name: null, tenant_ids: [TENANT.id] });
  });

  it('shows an error and does not call fetch when the email is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UserFormDialog onClose={jest.fn()} onSaved={jest.fn()} />);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('email es obligatorio');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the server error message (e.g. duplicate email) without closing the dialog', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'a user with that email already exists' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onClose = jest.fn();
    render(<UserFormDialog onClose={onClose} onSaved={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('Email'), 'dup@example.com');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = jest.fn();
    render(<UserFormDialog onClose={onClose} onSaved={jest.fn()} />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
