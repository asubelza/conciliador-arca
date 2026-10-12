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
  archivados: [],
  count_archivados: 0,
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
  archivados: [
    {
      id: 'v3',
      cuit_emisor: '30111111112',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 999,
      importe_total: 300,
      iva: null,
      fecha: '2026-05-01',
      file_source: 'arca',
      estado: 'archivado',
      periodo_alta_id: '',
      antiguedad_meses: 5,
    },
  ],
  count_archivados: 1,
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
    expect(screen.getByText(/pendientes desde el alta \(1 de 1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/anteriores al alta \(1 de 1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/30111111112 · Tipo 1 · PV 1 · Nro 100/)).toBeInTheDocument();
    expect(screen.getByText(/30111111112 · Tipo 1 · PV 1 · Nro 50/)).toBeInTheDocument();
    expect(screen.getByText('4 mes(es)')).toBeInTheDocument();
    expect(screen.getByText('9 mes(es)')).toBeInTheDocument();
  });

  it('shows "Sin filas." for both sections when there are no pendiente ARCA vouchers at all', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => emptyBody }) as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);

    expect(await screen.findByText(/pendientes desde el alta \(0 de 0\)/i)).toBeInTheDocument();
    expect(screen.getByText(/anteriores al alta \(0 de 0\)/i)).toBeInTheDocument();
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
    await screen.findByText(/pendientes desde el alta \(0 de 0\)/i);

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
    expect(screen.getByText(/pendientes desde el alta \(1 de 1\)/i)).toBeInTheDocument();
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
    await screen.findByText(/pendientes desde el alta \(0 de 0\)/i);
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
    await screen.findByText(/pendientes desde el alta \(0 de 0\)/i);

    await user.click(screen.getByRole('button', { name: /agregar comprobante arca/i }));

    await user.type(screen.getByLabelText(/cuit emisor/i), '30111111112');
    await user.type(screen.getByLabelText(/punto de venta/i), '1');
    await user.type(screen.getByLabelText(/número/i), '777');
    fireEvent.change(screen.getByLabelText(/fecha de emisión/i), { target: { value: '2026-10-12' } });
    await user.type(screen.getByLabelText(/importe total/i), '1000');
    // Exact match (not /iva/i): a loose regex also matches the "Ver
    // archivados" checkbox's accessible name (2026-10-12, Histórico filters
    // + "Archivar" — "archivados" contains the substring "iva").
    await user.type(screen.getByLabelText('IVA (opcional)'), '210');

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
    await screen.findByText(/pendientes desde el alta \(0 de 0\)/i);

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
    await screen.findByText(/pendientes desde el alta \(0 de 0\)/i);

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

/**
 * 2026-10-12 (Histórico filters + "Archivar"): filters narrowing the
 * visible rows, "ver archivados" toggling the third bucket, per-row and
 * bulk archivar flows, and role gating of every archivar control.
 */
const rowA = {
  id: 'v1',
  cuit_emisor: '30111111112',
  tipo_cbte: 1,
  punto_venta: 1,
  numero: 100,
  importe_total: 1000,
  iva: null,
  fecha: '2026-04-15',
  file_source: 'arca' as const,
  estado: 'pendiente' as const,
  periodo_alta_id: '',
  antiguedad_meses: 4,
};

const rowB = {
  id: 'v2',
  cuit_emisor: '30222222223',
  tipo_cbte: 6,
  punto_venta: 2,
  numero: 200,
  importe_total: 5000,
  iva: null,
  fecha: '2026-01-10',
  file_source: 'arca' as const,
  estado: 'pendiente' as const,
  periodo_alta_id: '',
  antiguedad_meses: 9,
};

const archivadoRow = {
  id: 'v3',
  cuit_emisor: '30333333334',
  tipo_cbte: 1,
  punto_venta: 1,
  numero: 300,
  importe_total: 700,
  iva: null,
  fecha: '2026-02-01',
  file_source: 'arca' as const,
  estado: 'archivado' as const,
  periodo_alta_id: '',
  antiguedad_meses: 8,
};

const twoRowsBody: PendientesHistoricoResult = {
  tenant: { id: TENANT_ID, name: 'Estudio Contable JY', created_at: '2026-03-01T00:00:00.000Z' },
  pendientes: [rowA, rowB],
  count_pendientes: 2,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
  archivados: [archivadoRow],
  count_archivados: 1,
};

describe('2026-10-12 (Histórico filters + "Archivar")', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('narrows the visible pendientes to those matching the CUIT filter', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => twoRowsBody }) as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);
    expect(screen.getByText(/30111111112/)).toBeInTheDocument();
    expect(screen.getByText(/30222222223/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/cuit \(filtro\)/i), '30222222223');

    expect(screen.getByText(/pendientes desde el alta \(1 de 2\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/30111111112/)).not.toBeInTheDocument();
    expect(screen.getByText(/30222222223/)).toBeInTheDocument();
  });

  it('narrows the visible pendientes to those matching the tipo de comprobante filter', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => twoRowsBody }) as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    await user.selectOptions(screen.getByLabelText(/tipo de comprobante/i), '6');

    expect(screen.getByText(/pendientes desde el alta \(1 de 2\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/30111111112/)).not.toBeInTheDocument();
    expect(screen.getByText(/30222222223/)).toBeInTheDocument();
  });

  it('"Limpiar filtros" resets every filter back to showing all rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => twoRowsBody }) as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    await user.type(screen.getByLabelText(/cuit \(filtro\)/i), '30222222223');
    expect(screen.getByText(/pendientes desde el alta \(1 de 2\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /limpiar filtros/i }));
    expect(screen.getByText(/pendientes desde el alta \(2 de 2\)/i)).toBeInTheDocument();
  });

  it('the "ver archivados" checkbox toggles the archivados table\'s visibility', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => twoRowsBody }) as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    expect(screen.queryByText(/30333333334/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /ver archivados/i }));
    expect(screen.getByText(/30333333334/)).toBeInTheDocument();
    expect(screen.getByText(/archivados \(1 de 1\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /ver archivados/i }));
    expect(screen.queryByText(/30333333334/)).not.toBeInTheDocument();
  });

  it('per-row archivar: opens the confirm dialog, calls the API, and refreshes the list', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('ya no corresponde');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => twoRowsBody }) // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: rowA.id, estado: 'archivado' }) }) // POST archivar
      .mockResolvedValueOnce({ ok: true, json: async () => emptyBody }); // refresh after archive
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    const archivarButtons = screen.getAllByRole('button', { name: 'Archivar' });
    await user.click(archivarButtons[0]);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(postCall![0]).toContain(`/api/tenants/${TENANT_ID}/comprobantes/${rowA.id}/archivar`);
      expect(JSON.parse(postCall![1].body)).toEqual({ nota: 'ya no corresponde' });
    });

    // refresh after archive — 1 initial load + 1 POST + 1 refresh load
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('bulk select + bulk archivar: selecting rows and confirming calls the lote endpoint with every selected id', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => twoRowsBody }) // initial load
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { voucher_id: rowA.id, status: 'archived' },
            { voucher_id: rowB.id, status: 'archived' },
          ],
        }),
      }) // POST archivar-lote
      .mockResolvedValueOnce({ ok: true, json: async () => emptyBody }); // refresh after archive
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    const checkboxes = screen.getAllByRole('checkbox', { name: /seleccionar comprobante/i });
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    await user.click(screen.getByRole('button', { name: /archivar seleccionados \(2\)/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(postCall![0]).toContain(`/api/tenants/${TENANT_ID}/comprobantes/archivar-lote`);
      const sentBody = JSON.parse(postCall![1].body);
      expect(sentBody.voucher_ids.sort()).toEqual([rowA.id, rowB.id].sort());
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('bulk archivar: a partial result (some skipped) surfaces an error naming which ids were skipped and why, not silent success', async () => {
    jest.spyOn(window, 'prompt').mockReturnValue('');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => twoRowsBody }) // initial load
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { voucher_id: rowA.id, status: 'archived' },
            { voucher_id: rowB.id, status: 'skipped', reason: 'already_conciliado' },
          ],
        }),
      }) // POST archivar-lote — partial result
      .mockResolvedValueOnce({ ok: true, json: async () => emptyBody }); // refresh after archive
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="admin" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    const checkboxes = screen.getAllByRole('checkbox', { name: /seleccionar comprobante/i });
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole('button', { name: /archivar seleccionados \(2\)/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('1 de 2');
    expect(alert).toHaveTextContent(rowB.id);
    expect(alert).toHaveTextContent('ya estaba conciliado');
  });

  it('does NOT render any archivar control (checkbox column, per-row button, bulk bar) for userRole === "cliente"', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => twoRowsBody }) as unknown as typeof fetch;

    render(<PendientesHistoricoViewer tenantId={TENANT_ID} userRole="cliente" />);
    await screen.findByText(/pendientes desde el alta \(2 de 2\)/i);

    expect(screen.queryAllByRole('button', { name: 'Archivar' })).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox', { name: /seleccionar comprobante/i })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /archivar seleccionados/i })).not.toBeInTheDocument();
  });
});
