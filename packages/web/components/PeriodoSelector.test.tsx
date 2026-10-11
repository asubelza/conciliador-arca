import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodoSelector } from './PeriodoSelector';
import { clearSession, setSession } from '@/lib/session';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

/**
 * T39 (Fase 3, autenticacion-roles) + AD-6 (dashboard-principal): slimmed
 * down to pure tenant-entry — período list/create moved into Dashboard
 * (see Dashboard.test.tsx). `onSelected` now yields ONLY the tenantId; the
 * admin-only tolerance config panel stays here (design §AD-6).
 *
 * No tenant-existence round-trip: `GET /api/periodos` doesn't check a
 * `tenants` table for admin/colaborador, so a client-side validation call
 * here would have validated nothing — see PeriodoSelector.tsx's comment.
 */
describe('T30/AD-6: PeriodoSelector (tenant entry only)', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('rejects a non-UUID tenant_id, does not confirm a tenant, and never hits the network', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const onSelected = jest.fn();
    render(<PeriodoSelector onSelected={onSelected} />);

    await userEvent.type(screen.getByLabelText(/tenant id/i), 'not-a-uuid');
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('tenant_id is required and must be a UUID');
    expect(screen.queryByRole('button', { name: /continuar al dashboard/i })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('confirms a valid UUID synchronously (no network round-trip) and calls onSelected with ONLY the tenantId on continue', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const onSelected = jest.fn();
    render(<PeriodoSelector onSelected={onSelected} />);

    await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByText(new RegExp(TENANT_ID))).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /continuar al dashboard/i }));

    expect(onSelected).toHaveBeenCalledWith(TENANT_ID);
    expect(onSelected).toHaveBeenCalledTimes(1);
  });

  it('toggles the tenant tolerance config panel for admin', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tolerancia_redondeo_ars: '0.99', tolerancia_dias_fecha: 5 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PeriodoSelector onSelected={jest.fn()} />);
    await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    await screen.findByRole('button', { name: /continuar al dashboard/i });

    expect(screen.queryByLabelText(/tolerancia de redondeo/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /configurar tolerancia/i }));
    expect(await screen.findByLabelText(/tolerancia de redondeo/i)).toBeInTheDocument();
  });

  describe('role-gating (T39, autenticacion-roles)', () => {
    it('cliente does not see the tolerance config toggle', async () => {
      setSession('fake-token', { id: 'u2', email: 'cliente@example.com', role: 'cliente', display_name: null });

      render(<PeriodoSelector onSelected={jest.fn()} />);
      await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
      await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
      await screen.findByRole('button', { name: /continuar al dashboard/i });

      expect(screen.queryByRole('button', { name: /configurar tolerancia/i })).not.toBeInTheDocument();
    });

    it('colaborador does not see the tolerance config toggle (admin-only)', async () => {
      setSession('fake-token', { id: 'u3', email: 'colaborador@example.com', role: 'colaborador', display_name: null });

      render(<PeriodoSelector onSelected={jest.fn()} />);
      await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
      await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
      await screen.findByRole('button', { name: /continuar al dashboard/i });

      expect(screen.queryByRole('button', { name: /configurar tolerancia/i })).not.toBeInTheDocument();
    });
  });
});
