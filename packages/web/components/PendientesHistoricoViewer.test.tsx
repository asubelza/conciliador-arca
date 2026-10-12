import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendientesHistoricoViewer } from './PendientesHistoricoViewer';
import { clearSession, setSession } from '@/lib/session';
import type { PendientesHistoricoResult } from '@/lib/api';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const emptyBody: PendientesHistoricoResult = {
  tenant: { id: TENANT_ID, name: 'Estudio Contable JY', created_at: '2026-03-01T00:00:00.000Z' },
  pendientes: [],
  count_pendientes: 0,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
};

const populatedBody: PendientesHistoricoResult = {
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
      periodo_alta_id: '',
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
      periodo_alta_id: '',
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

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);

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

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);

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

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/tenant not found/i);
    });
  });

  it('requests the correct endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(0\)/i);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/tenants/${TENANT_ID}/pendientes-historico`),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }) }),
    );
  });

  it('usa initialResult sin fetchear de nuevo cuando ya viene provisto (evita el refetch redundante de Section C)', () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} initialResult={populatedBody} userRole="admin" />);

    expect(screen.getByText(/histórico de pendientes en arca/i)).toBeInTheDocument();
    expect(screen.getByText(/pendientes desde el alta \(1\)/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-12 (manual ARCA voucher creation): coverage for the "Agregar
 * comprobante ARCA" button/form added to PendientesHistoricoViewer — gated
 * by `userRole !== 'cliente'` (same posture as every other mutating action
 * in the dashboard), submits via createVoucherArcaManual (lib/api.ts), and
 * refreshes the histórico list (reuses the component's own `load`).
 */
describe('2026-10-12 (manual ARCA voucher creation): Agregar comprobante ARCA', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('renders the button for admin', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody }) as unknown as typeof fetch;
    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    expect(await screen.findByRole('button', { name: /agregar comprobante arca/i })).toBeInTheDocument();
  });

  it('renders the button for colaborador', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody }) as unknown as typeof fetch;
    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="colaborador" />);
    expect(await screen.findByRole('button', { name: /agregar comprobante arca/i })).toBeInTheDocument();
  });

  it('does NOT render the button for cliente', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody }) as unknown as typeof fetch;
    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="cliente" />);
    await screen.findByText(/pendientes desde el alta \(0\)/i);
    expect(screen.queryByRole('button', { name: /agregar comprobante arca/i })).not.toBeInTheDocument();
  });

  it('submits valid form data, calls the API, and refreshes the list', async () => {
    const user = userEvent.setup();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => emptyBody }) // initial load
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'new-voucher',
          cuit_emisor: '30111111112',
          tipo_cbte: 1,
          punto_venta: 1,
          numero: 777,
          importe_total: 1000,
          iva: 210,
          fecha: '2026-10-12',
          file_source: 'arca',
          estado: 'pendiente',
          periodo_alta_id: null,
        }),
      }) // POST .../comprobantes-arca
      .mockResolvedValueOnce({ ok: true, json: async () => emptyBody }); // refresh after create
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(0\)/i);

    await user.click(screen.getByRole('button', { name: /agregar comprobante arca/i }));

    await user.type(screen.getByLabelText(/cuit emisor/i), '30111111112');
    await user.type(screen.getByLabelText(/punto de venta/i), '1');
    await user.type(screen.getByLabelText(/número/i), '777');
    fireEvent.change(screen.getByLabelText(/fecha de emisión/i), { target: { value: '2026-10-12' } });
    await user.type(screen.getByLabelText(/importe total/i), '1000');
    await user.type(screen.getByLabelText(/iva/i), '210');

    await user.click(screen.getByRole('button', { name: /guardar comprobante/i }));

    await waitFor(() => {
      expect(screen.getByText(/comprobante registrado/i)).toBeInTheDocument();
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeDefined();
    expect(postCall![0]).toContain(`/api/tenants/${TENANT_ID}/comprobantes-arca`);
    expect(JSON.parse(postCall![1].body)).toEqual({
      cuit_emisor: '30111111112',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 777,
      fecha_emision: '2026-10-12',
      importe_total_ars: 1000,
      iva: 210,
    });

    // refresh after create — 1 initial load + 1 POST + 1 refresh load
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces an API error returned by the backend (e.g. validation or 409 conflict)', async () => {
    const user = userEvent.setup();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => emptyBody }) // initial load
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'ya existe un comprobante ARCA conciliado con esa clave' }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(0\)/i);

    await user.click(screen.getByRole('button', { name: /agregar comprobante arca/i }));
    await user.type(screen.getByLabelText(/cuit emisor/i), '30111111112');
    await user.type(screen.getByLabelText(/punto de venta/i), '1');
    await user.type(screen.getByLabelText(/número/i), '777');
    fireEvent.change(screen.getByLabelText(/fecha de emisión/i), { target: { value: '2026-10-12' } });
    await user.type(screen.getByLabelText(/importe total/i), '1000');
    await user.click(screen.getByRole('button', { name: /guardar comprobante/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya existe un comprobante arca conciliado/i);
  });

  it('surfaces a client-side validation error without calling the API, for an incomplete cuit_emisor', async () => {
    const user = userEvent.setup();
    const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => emptyBody });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(0\)/i);

    await user.click(screen.getByRole('button', { name: /agregar comprobante arca/i }));
    await user.type(screen.getByLabelText(/cuit emisor/i), '123');
    await user.type(screen.getByLabelText(/punto de venta/i), '1');
    await user.type(screen.getByLabelText(/número/i), '777');
    fireEvent.change(screen.getByLabelText(/fecha de emisión/i), { target: { value: '2026-10-12' } });
    await user.type(screen.getByLabelText(/importe total/i), '1000');
    await user.click(screen.getByRole('button', { name: /guardar comprobante/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cuit_emisor/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial load — no POST attempted
  });
});
