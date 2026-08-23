import { render, screen, waitFor } from '@testing-library/react';
import { PendientesHistoricoViewer } from './PendientesHistoricoViewer';
import { clearSession, setSession } from '@/lib/session';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const emptyBody = {
  tenant: { id: TENANT_ID, name: 'Estudio Contable JY', created_at: '2026-03-01T00:00:00.000Z' },
  pendientes: [],
  count_pendientes: 0,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
};

const populatedBody = {
  tenant: { id: TENANT_ID, name: 'Estudio Contable JY', created_at: '2026-03-01T00:00:00.000Z' },
  pendientes: [
    {
      id: 'v1',
      cuit_emisor: '30111111112',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 100,
      importe_total: 1000,
      iva: null,
      fecha: '2026-04-15',
      file_source: 'arca',
      estado: 'pendiente',
      periodo_alta_id: null,
      antiguedad_meses: 4,
    },
  ],
  count_pendientes: 1,
  excluidos_previos_a_alta: [
    {
      id: 'v2',
      cuit_emisor: '30111111112',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 50,
      importe_total: 500,
      iva: null,
      fecha: '2025-11-01',
      file_source: 'arca',
      estado: 'pendiente',
      periodo_alta_id: null,
      antiguedad_meses: 9,
    },
  ],
  count_excluidos_previos_a_alta: 1,
};

/**
 * 2026-08-23 (feature 3 de 3): T31-style coverage for the new tenant-wide
 * "Histórico de Pendientes en ARCA" screen (PendientesHistoricoViewer.tsx),
 * reachable after cerrar un período (see app/page.test.tsx's own note that
 * per-component behavior lives in each component's own test file).
 */
describe('2026-08-23 (feature 3 de 3): PendientesHistoricoViewer', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('fetches and renders the tenant alta date + both sections, with counts', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => populatedBody }) as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} />);

    expect(await screen.findByText(/histórico de pendientes en arca/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-03-01/)).toBeInTheDocument();
    expect(screen.getByText(/pendientes desde el alta \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/anteriores al alta \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/30111111112 · Tipo 1 · PV 1 · Nro 100/)).toBeInTheDocument();
    expect(screen.getByText(/30111111112 · Tipo 1 · PV 1 · Nro 50/)).toBeInTheDocument();
    expect(screen.getByText('4 mes(es)')).toBeInTheDocument();
    expect(screen.getByText('9 mes(es)')).toBeInTheDocument();
  });

  it('shows "Sin filas." for both sections when there are no pendiente ARCA vouchers at all', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody }) as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} />);

    expect(await screen.findByText(/pendientes desde el alta \(0\)/i)).toBeInTheDocument();
    expect(screen.getByText(/anteriores al alta \(0\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/sin filas\./i)).toHaveLength(2);
  });

  it('shows an error message when the fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'tenant not found' }),
    }) as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/tenant not found/i);
    });
  });

  it('requests the correct endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} />);
    await screen.findByText(/pendientes desde el alta \(0\)/i);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/tenants/${TENANT_ID}/pendientes-historico`),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }) }),
    );
  });
});
