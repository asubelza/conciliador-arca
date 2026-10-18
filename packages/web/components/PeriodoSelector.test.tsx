import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodoSelector } from './PeriodoSelector';
import { clearSession, setSession } from '@/lib/session';

const TENANT_A = { id: '11111111-1111-1111-1111-111111111111', name: 'Tenant A' };
const TENANT_B = { id: '22222222-2222-2222-2222-222222222222', name: 'Tenant B' };

function mockTenantsFetch(tenants: Array<{ id: string; name: string }>) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => tenants,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/**
 * tenant-discovery + T30/AD-6: PeriodoSelector no longer makes every role
 * paste a raw tenant UUID — it calls listMyTenants() (GET
 * /api/auth/me/tenants) on mount and renders a <select> of tenant NAMES
 * instead. `global.fetch` is mocked directly here, same convention as
 * TenantConfigPanel.test.tsx's fetch-on-mount tests, rather than
 * jest.mock('@/lib/api') — lib/api.ts is dependency-free (no framework
 * imports), so mocking the underlying fetch call exercises the real
 * listMyTenants() implementation too.
 *
 * Período list/create moved into Dashboard (see Dashboard.test.tsx) — not
 * retested here.
 */
describe('tenant-discovery: PeriodoSelector (tenant entry only)', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('loads tenants on mount, lets the user pick one by name, and calls onSelected with ONLY the tenantId on continue', async () => {
    mockTenantsFetch([TENANT_A, TENANT_B]);
    const onSelected = jest.fn();
    render(<PeriodoSelector onSelected={onSelected} />);

    const select = await screen.findByLabelText(/tenant/i);
    expect(screen.getByRole('option', { name: TENANT_A.name })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: TENANT_B.name })).toBeInTheDocument();

    await userEvent.selectOptions(select, TENANT_B.id);
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByText(new RegExp(TENANT_B.id))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continuar al dashboard/i }));

    expect(onSelected).toHaveBeenCalledWith(TENANT_B.id);
    expect(onSelected).toHaveBeenCalledTimes(1);
  });

  it('shows a message and no form when the user has no tenants assigned', async () => {
    mockTenantsFetch([]);
    render(<PeriodoSelector onSelected={jest.fn()} />);

    expect(await screen.findByText(/no ten[ée]s tenants asignados/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ingresar/i })).not.toBeInTheDocument();
  });

  it('shows an error message, not a crash, when the tenants fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }) as unknown as typeof fetch;

    render(<PeriodoSelector onSelected={jest.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
  });

  it('toggles the tenant tolerance config panel for admin', async () => {
    const fetchMock = mockTenantsFetch([TENANT_A]);
    render(<PeriodoSelector onSelected={jest.fn()} />);

    const select = await screen.findByLabelText(/tenant/i);
    await userEvent.selectOptions(select, TENANT_A.id);
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    await screen.findByRole('button', { name: /continuar al dashboard/i });

    expect(screen.queryByLabelText(/tolerancia de redondeo/i)).not.toBeInTheDocument();

    // TenantConfigPanel fetches its own config on expand — reuse the same
    // mock, this time for the config shape instead of the tenants list.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tolerancia_redondeo_ars: '0.99', tolerancia_dias_fecha: 5 }),
    });
    await userEvent.click(screen.getByRole('button', { name: /configurar tolerancia/i }));
    expect(await screen.findByLabelText(/tolerancia de redondeo/i)).toBeInTheDocument();
  });

  describe('role-gating (T39, autenticacion-roles)', () => {
    it('cliente does not see the tolerance config toggle', async () => {
      setSession('fake-token', { id: 'u2', email: 'cliente@example.com', role: 'cliente', display_name: null });
      mockTenantsFetch([TENANT_A]);

      render(<PeriodoSelector onSelected={jest.fn()} />);
      const select = await screen.findByLabelText(/tenant/i);
      await userEvent.selectOptions(select, TENANT_A.id);
      await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
      await screen.findByRole('button', { name: /continuar al dashboard/i });

      expect(screen.queryByRole('button', { name: /configurar tolerancia/i })).not.toBeInTheDocument();
    });

    it('colaborador does not see the tolerance config toggle (admin-only)', async () => {
      setSession('fake-token', { id: 'u3', email: 'colaborador@example.com', role: 'colaborador', display_name: null });
      mockTenantsFetch([TENANT_A]);

      render(<PeriodoSelector onSelected={jest.fn()} />);
      const select = await screen.findByLabelText(/tenant/i);
      await userEvent.selectOptions(select, TENANT_A.id);
      await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
      await screen.findByRole('button', { name: /continuar al dashboard/i });

      expect(screen.queryByRole('button', { name: /configurar tolerancia/i })).not.toBeInTheDocument();
    });
  });
});
