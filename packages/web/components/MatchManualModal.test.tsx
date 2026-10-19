import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MatchManualModal } from './MatchManualModal';
import { clearSession, setSession } from '@/lib/session';
import type { PendientesHistoricoResult } from '@/lib/api';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PERIODO_ID = '22222222-2222-2222-2222-222222222222';
const SISTEMA_VOUCHER_ID = 's5';

const pendienteRow = {
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

const archivadoRow = {
  id: 'v2',
  cuit_emisor: '30222222223',
  tipo_cbte: 6,
  punto_venta: 2,
  numero: 200,
  importe_total: 5000,
  iva: null,
  fecha: '2026-01-10',
  file_source: 'arca' as const,
  estado: 'archivado' as const,
  periodo_alta_id: '',
  antiguedad_meses: 9,
};

const historicoBody: PendientesHistoricoResult = {
  tenant: { id: TENANT_ID, name: 'Estudio Contable JY', created_at: '2026-03-01T00:00:00.000Z' },
  pendientes: [pendienteRow],
  count_pendientes: 1,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
  archivados: [archivadoRow],
  count_archivados: 1,
};

/**
 * 2026-10-12 ("Match manual" para filas no_existe_en_arca): coverage for
 * MatchManualModal's three tabs — "Buscar pendientes ARCA" (confirmarCoincidencia
 * directly), "Buscar en archivados" (desarchivarComprobanteArca THEN
 * confirmarCoincidencia, stopping if desarchivar fails), and "Agregar
 * comprobante" (creates via the extracted AgregarComprobanteArcaForm, then
 * switches back to "buscar" with a refreshed list).
 */
describe('MatchManualModal', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null, estudio_id: 'test-estudio-id' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('renders the "Buscar pendientes ARCA" tab with the pendientes list by default', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => historicoBody }) as unknown as typeof fetch;
    const onClose = jest.fn();
    const onMatched = jest.fn();

    render(
      <MatchManualModal
        periodoId={PERIODO_ID}
        sistemaVoucherId={SISTEMA_VOUCHER_ID}
        tenantId={TENANT_ID}
        onClose={onClose}
        onMatched={onMatched}
      />,
    );

    expect(await screen.findByText(/30111111112/)).toBeInTheDocument();
    expect(screen.queryByText(/30222222223/)).not.toBeInTheDocument(); // archivado row not shown on this tab
  });

  it('switches to "Buscar en archivados" and shows the archivados bucket instead', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => historicoBody }) as unknown as typeof fetch;

    render(
      <MatchManualModal
        periodoId={PERIODO_ID}
        sistemaVoucherId={SISTEMA_VOUCHER_ID}
        tenantId={TENANT_ID}
        onClose={jest.fn()}
        onMatched={jest.fn()}
      />,
    );
    await screen.findByText(/30111111112/);

    await userEvent.click(screen.getByRole('button', { name: /buscar en archivados/i }));

    expect(await screen.findByText(/30222222223/)).toBeInTheDocument();
    expect(screen.queryByText(/30111111112/)).not.toBeInTheDocument();
  });

  it('filters the visible list by the free-text query', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => historicoBody }) as unknown as typeof fetch;

    render(
      <MatchManualModal
        periodoId={PERIODO_ID}
        sistemaVoucherId={SISTEMA_VOUCHER_ID}
        tenantId={TENANT_ID}
        onClose={jest.fn()}
        onMatched={jest.fn()}
      />,
    );
    await screen.findByText(/30111111112/);

    await userEvent.type(screen.getByLabelText(/filtrar/i), '99999999999');

    expect(screen.queryByText(/30111111112/)).not.toBeInTheDocument();
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  describe('"Buscar pendientes ARCA" tab: confirm flow', () => {
    it('calls confirmarCoincidencia with sistemaVoucherId + the chosen arca id, then onMatched + onClose', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => historicoBody }) // initial load
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tenant_id: 't1', sistema_voucher_id: SISTEMA_VOUCHER_ID, arca_voucher_id: 'v1', status: 'confirmado', created_by: 'u1', created_at: '2026-10-12T00:00:00Z' }),
        }); // POST .../coincidencias
      global.fetch = fetchMock as unknown as typeof fetch;
      const onClose = jest.fn();
      const onMatched = jest.fn();

      render(
        <MatchManualModal
          periodoId={PERIODO_ID}
          sistemaVoucherId={SISTEMA_VOUCHER_ID}
          tenantId={TENANT_ID}
          onClose={onClose}
          onMatched={onMatched}
        />,
      );
      await screen.findByText(/30111111112/);

      await act(async () => {
        await userEvent.click(screen.getByRole('button', { name: /usar este/i }));
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/api/periodos/${PERIODO_ID}/coincidencias`),
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ sistema_voucher_id: SISTEMA_VOUCHER_ID, arca_voucher_id: 'v1', accion: 'confirmar' });
      await waitFor(() => expect(onMatched).toHaveBeenCalled());
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('"Buscar en archivados" tab: desarchivar -> confirmar sequencing', () => {
    it('calls desarchivarComprobanteArca THEN confirmarCoincidencia, in that order', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => historicoBody }) // initial load
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'v2', estado: 'pendiente' }) }) // POST .../desarchivar
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tenant_id: 't1', sistema_voucher_id: SISTEMA_VOUCHER_ID, arca_voucher_id: 'v2', status: 'confirmado', created_by: 'u1', created_at: '2026-10-12T00:00:00Z' }),
        }); // POST .../coincidencias
      global.fetch = fetchMock as unknown as typeof fetch;
      const onClose = jest.fn();
      const onMatched = jest.fn();

      render(
        <MatchManualModal
          periodoId={PERIODO_ID}
          sistemaVoucherId={SISTEMA_VOUCHER_ID}
          tenantId={TENANT_ID}
          onClose={onClose}
          onMatched={onMatched}
        />,
      );
      await screen.findByText(/30111111112/);
      await userEvent.click(screen.getByRole('button', { name: /buscar en archivados/i }));
      await screen.findByText(/30222222223/);

      await act(async () => {
        await userEvent.click(screen.getByRole('button', { name: /usar este/i }));
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/api/tenants/${TENANT_ID}/comprobantes/v2/desarchivar`),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining(`/api/periodos/${PERIODO_ID}/coincidencias`),
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
      expect(body).toEqual({ sistema_voucher_id: SISTEMA_VOUCHER_ID, arca_voucher_id: 'v2', accion: 'confirmar' });
      await waitFor(() => expect(onMatched).toHaveBeenCalled());
      expect(onClose).toHaveBeenCalled();
    });

    it('stops before confirmarCoincidencia when desarchivar fails, and surfaces the error', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => historicoBody }) // initial load
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: async () => ({ error: 'this voucher was resolved by a concurrent operation' }),
        }); // POST .../desarchivar fails
      global.fetch = fetchMock as unknown as typeof fetch;
      const onClose = jest.fn();
      const onMatched = jest.fn();

      render(
        <MatchManualModal
          periodoId={PERIODO_ID}
          sistemaVoucherId={SISTEMA_VOUCHER_ID}
          tenantId={TENANT_ID}
          onClose={onClose}
          onMatched={onMatched}
        />,
      );
      await screen.findByText(/30111111112/);
      await userEvent.click(screen.getByRole('button', { name: /buscar en archivados/i }));
      await screen.findByText(/30222222223/);

      await act(async () => {
        await userEvent.click(screen.getByRole('button', { name: /usar este/i }));
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(/resolved by a concurrent operation/i);
      // only the initial load + the failed desarchivar — confirmarCoincidencia never fired
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onMatched).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('"Agregar comprobante" tab', () => {
    it('creates a voucher via the extracted form, then switches back to "buscar" with a refreshed list', async () => {
      const refreshedBody: PendientesHistoricoResult = {
        ...historicoBody,
        pendientes: [
          ...historicoBody.pendientes,
          {
            id: 'v3',
            cuit_emisor: '30333333334',
            tipo_cbte: 1,
            punto_venta: 1,
            numero: 777,
            importe_total: 1000,
            iva: null,
            fecha: '2026-10-12',
            file_source: 'arca',
            estado: 'pendiente',
            periodo_alta_id: '',
            antiguedad_meses: 0,
          },
        ],
      };
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => historicoBody }) // initial load
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'v3',
            cuit_emisor: '30333333334',
            tipo_cbte: 1,
            punto_venta: 1,
            numero: 777,
            importe_total: 1000,
            iva: null,
            fecha: '2026-10-12',
            file_source: 'arca',
            estado: 'pendiente',
            periodo_alta_id: null,
          }),
        }) // POST .../comprobantes-arca
        .mockResolvedValueOnce({ ok: true, json: async () => refreshedBody }); // refresh after create
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();

      render(
        <MatchManualModal
          periodoId={PERIODO_ID}
          sistemaVoucherId={SISTEMA_VOUCHER_ID}
          tenantId={TENANT_ID}
          onClose={jest.fn()}
          onMatched={jest.fn()}
        />,
      );
      await screen.findByText(/30111111112/);

      await user.click(screen.getByRole('button', { name: /agregar comprobante/i }));
      await user.click(screen.getByRole('button', { name: /agregar comprobante arca/i }));

      await user.type(screen.getByLabelText(/cuit emisor/i), '30333333334');
      await user.type(screen.getByLabelText(/punto de venta/i), '1');
      await user.type(screen.getByLabelText(/número/i), '777');
      fireEvent.change(screen.getByLabelText(/fecha de emisión/i), { target: { value: '2026-10-12' } });
      await user.type(screen.getByLabelText(/importe total/i), '1000');

      await user.click(screen.getByRole('button', { name: /guardar comprobante/i }));

      // Switches back to "buscar" automatically — the newly created voucher
      // shows up there, never auto-confirmed sight-unseen.
      await waitFor(() => expect(screen.getByText(/30333333334/)).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('focus trap + Escape (ConfirmDialog-style shell)', () => {
    it('closes on Escape when no action is in flight', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => historicoBody }) as unknown as typeof fetch;
      const onClose = jest.fn();

      render(
        <MatchManualModal
          periodoId={PERIODO_ID}
          sistemaVoucherId={SISTEMA_VOUCHER_ID}
          tenantId={TENANT_ID}
          onClose={onClose}
          onMatched={jest.fn()}
        />,
      );
      await screen.findByText(/30111111112/);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('closes when the "Cerrar" button is clicked', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => historicoBody }) as unknown as typeof fetch;
      const onClose = jest.fn();

      render(
        <MatchManualModal
          periodoId={PERIODO_ID}
          sistemaVoucherId={SISTEMA_VOUCHER_ID}
          tenantId={TENANT_ID}
          onClose={onClose}
          onMatched={jest.fn()}
        />,
      );
      await screen.findByText(/30111111112/);

      const dialog = screen.getByRole('dialog', { name: /match manual/i });
      await userEvent.click(within(dialog).getByRole('button', { name: /cerrar/i }));

      expect(onClose).toHaveBeenCalled();
    });
  });
});
