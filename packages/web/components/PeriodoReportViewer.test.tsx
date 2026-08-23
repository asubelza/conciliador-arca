import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodoReportViewer } from './PeriodoReportViewer';
import { clearSession, setSession } from '@/lib/session';

const PERIODO_ID = '22222222-2222-2222-2222-222222222222';

const openReportBody = {
  periodo: {
    id: PERIODO_ID,
    tenant_id: 't1',
    mes: '2026-04-01',
    estado: 'abierto',
    tolerancia_ars: null,
    cerrado_at: null,
    cerrado_por: null,
  },
  live: true,
  sections: {
    conciliados_ok: [
      {
        classification: 'conciliado_ok',
        composite_key: '30111111112|1|1|100',
        sistema: { id: 's1', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, importe_total: 1000, iva: null, fecha: null, file_source: 'contabilidad', estado: 'pendiente', periodo_alta_id: PERIODO_ID },
        arca: { id: 'a1', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, importe_total: 1000, iva: null, fecha: null, file_source: 'arca', estado: 'pendiente', periodo_alta_id: PERIODO_ID },
        divergencia_ars: null,
        antiguedad_meses: null,
        similarity_reason: null,
        feedback_previo: null,
      },
    ],
    discrepancias_y_alertas: [],
    pendientes_en_arca: [
      {
        classification: 'pendiente_en_arca',
        composite_key: '30111111112|1|1|200',
        sistema: null,
        arca: { id: 'a2', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 200, importe_total: 300, iva: null, fecha: null, file_source: 'arca', estado: 'pendiente', periodo_alta_id: PERIODO_ID },
        divergencia_ars: null,
        antiguedad_meses: 3,
        similarity_reason: null,
        feedback_previo: null,
      },
    ],
    posibles_coincidencias: [],
  },
};

const pendienteRowWithFeedback = {
  classification: 'pendiente_en_arca',
  composite_key: '30111111112|1|1|400',
  sistema: null,
  arca: { id: 'a4', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 400, importe_total: 700, iva: null, fecha: null, file_source: 'arca', estado: 'pendiente', periodo_alta_id: PERIODO_ID },
  divergencia_ars: null,
  antiguedad_meses: 5,
  similarity_reason: null,
  feedback_previo: { classification: 'revisado', note: null, created_at: '2026-03-01T00:00:00Z' },
};

const reportWithFeedback = {
  ...openReportBody,
  sections: {
    ...openReportBody.sections,
    pendientes_en_arca: [...openReportBody.sections.pendientes_en_arca, pendienteRowWithFeedback],
  },
};

const coincidenciaRow = {
  classification: 'posible_coincidencia',
  composite_key: '30111111112|1|1|300',
  sistema: { id: 's3', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 301, importe_total: 500, iva: null, fecha: '2026-04-10', file_source: 'contabilidad', estado: 'pendiente', periodo_alta_id: PERIODO_ID },
  arca: { id: 'a3', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 300, importe_total: 500, iva: null, fecha: '2026-04-10', file_source: 'arca', estado: 'pendiente', periodo_alta_id: PERIODO_ID },
  divergencia_ars: null,
  antiguedad_meses: null,
  similarity_reason: 'numero difiere en 1 dígito (posible error de tipeo)',
  feedback_previo: null,
};

const reportWithCoincidencia = {
  ...openReportBody,
  sections: { ...openReportBody.sections, posibles_coincidencias: [coincidenciaRow] },
};

/**
 * T39 (Fase 3, autenticacion-roles): CSV/Excel are buttons now (an `<a
 * href>` can't carry the Authorization header every report endpoint has
 * required since Fase 2 — see lib/api.ts's downloadAuthenticated), and the
 * "Cerrar Conciliación del Mes" button is hidden for role='cliente'
 * (read-only, RF-14). Every test needs a session — admin by default so the
 * pre-existing behavior is unaffected; the dedicated 'role-gating' block
 * covers cliente.
 */
describe('T31: PeriodoReportViewer', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('fetches and renders the 3 sections, with antigüedad_meses in Pendientes en ARCA', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody }) as unknown as typeof fetch;

    render(<PeriodoReportViewer periodoId={PERIODO_ID} />);

    expect(await screen.findByText(/conciliados ok \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/pendientes en arca \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // antiguedad_meses cell
  });

  it('offers CSV/Excel download buttons for the período report (client-requested 2026-08-22)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody }) as unknown as typeof fetch;

    render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
    await screen.findByText(/conciliados ok \(1\)/i);

    expect(screen.getByRole('button', { name: /descargar csv/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descargar excel/i })).toBeInTheDocument();
  });

  it('downloads the XLSX report via an authenticated fetch when clicked', async () => {
    const xlsxBlob = { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => openReportBody })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => `attachment; filename="periodo-2026-04-01-${PERIODO_ID}.xlsx"` },
        blob: async () => xlsxBlob,
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');
    window.URL.revokeObjectURL = jest.fn();
    // See ReportViewer.test.tsx's equivalent test for why click() is stubbed.
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
    const xlsxButton = await screen.findByRole('button', { name: /descargar excel/i });
    await act(async () => {
      await userEvent.click(xlsxButton);
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(`/api/periodos/${PERIODO_ID}/report?format=xlsx`),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }) }),
    );
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(xlsxBlob);
  });

  it('shows the Cerrar Conciliación del Mes button only while abierto, and confirms before closing', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => openReportBody })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ periodo: { ...openReportBody.periodo, estado: 'cerrado' }, counts: { conciliado_ok: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...openReportBody, live: false, periodo: { ...openReportBody.periodo, estado: 'cerrado' } }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onClosed = jest.fn();
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<PeriodoReportViewer periodoId={PERIODO_ID} onClosed={onClosed} />);
    const cerrarButton = await screen.findByRole('button', { name: /cerrar conciliaci[oó]n del mes/i });

    await act(async () => {
      await userEvent.click(cerrarButton);
    });

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(onClosed).toHaveBeenCalledWith(expect.objectContaining({ estado: 'cerrado' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /cerrar conciliaci[oó]n del mes/i })).not.toBeInTheDocument());
  });

  it('does not close when the confirmation is declined', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
    const cerrarButton = await screen.findByRole('button', { name: /cerrar conciliaci[oó]n del mes/i });
    await userEvent.click(cerrarButton);

    expect(window.confirm).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial report load, no cierre POST
  });

  describe('role-gating (T39, autenticacion-roles)', () => {
    it('cliente never sees "Cerrar Conciliación del Mes" even while abierto (read-only, RF-14)', async () => {
      setSession('fake-token', { id: 'u2', email: 'cliente@example.com', role: 'cliente', display_name: null });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody }) as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      await screen.findByText(/conciliados ok \(1\)/i);

      expect(screen.queryByRole('button', { name: /cerrar conciliaci[oó]n del mes/i })).not.toBeInTheDocument();
    });
  });

  describe('RF-04: Posible Coincidencia section', () => {
    it('renders the section with the similarity reason and lets the contador confirm a pairing', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => reportWithCoincidencia })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ...coincidenciaRow, status: 'confirmado' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      expect(await screen.findByText(/posible coincidencia \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/numero difiere en 1 dígito/i)).toBeInTheDocument();

      const confirmarButton = screen.getByRole('button', { name: /^confirmar$/i });
      await act(async () => {
        await userEvent.click(confirmarButton);
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/api/periodos/${PERIODO_ID}/coincidencias`),
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ sistema_voucher_id: 's3', arca_voucher_id: 'a3', accion: 'confirmar' });
      // Confirming reloads the report — a 3rd fetch happens.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    });

    it('lets the contador descartar a pairing', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => reportWithCoincidencia })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ...coincidenciaRow, status: 'descartado' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const descartarButton = await screen.findByRole('button', { name: /^descartar$/i });
      await act(async () => {
        await userEvent.click(descartarButton);
      });

      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ sistema_voucher_id: 's3', arca_voucher_id: 'a3', accion: 'descartar' });
    });

    it('cliente sees the section but no Confirmar/Descartar/mark buttons (read-only, RF-14)', async () => {
      setSession('fake-token', { id: 'u3', email: 'cliente@example.com', role: 'cliente', display_name: null });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => reportWithCoincidencia }) as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      expect(await screen.findByText(/posible coincidencia \(1\)/i)).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^descartar$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^revisado$/i })).not.toBeInTheDocument();
    });
  });

  /**
   * T39 (pedido del cliente, 2026-08-23, feature 3 de 3): clicking a
   * "Posible Coincidencia" row opens a field-by-field comparison modal with
   * its own Confirmar/Descartar — a second way to reach the same
   * confirmarCoincidencia() action as the inline quick buttons above,
   * which this whole describe block confirms are still there untouched.
   */
  describe('T39: modal de comparación al hacer click en la fila', () => {
    it('opens a dialog with the field-by-field comparison when the row is clicked, and Confirmar inside it calls the same API', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => reportWithCoincidencia })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ...coincidenciaRow, status: 'confirmado' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const row = await screen.findByRole('button', { name: /comparar posible coincidencia/i });

      await userEvent.click(row);

      const dialog = screen.getByRole('dialog', { name: /comparar posible coincidencia/i });
      // numero differs (301 vs 300) — both values for that field show up inside the dialog.
      expect(within(dialog).getByText('301')).toBeInTheDocument();
      expect(within(dialog).getByText('300')).toBeInTheDocument();

      const modalConfirmar = within(dialog).getByRole('button', { name: /^confirmar$/i });
      await act(async () => {
        await userEvent.click(modalConfirmar);
      });

      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ sistema_voucher_id: 's3', arca_voucher_id: 'a3', accion: 'confirmar' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes the dialog without calling the API when "Cerrar" is clicked', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => reportWithCoincidencia }) as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const row = await screen.findByRole('button', { name: /comparar posible coincidencia/i });
      await userEvent.click(row);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /^cerrar$/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('cliente can open the comparison dialog but sees no Confirmar/Descartar inside it (read-only, RF-14)', async () => {
      setSession('fake-token', { id: 'u3', email: 'cliente@example.com', role: 'cliente', display_name: null });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => reportWithCoincidencia }) as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const row = await screen.findByRole('button', { name: /comparar posible coincidencia/i });
      await userEvent.click(row);

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByRole('button', { name: /^confirmar$/i })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /^descartar$/i })).not.toBeInTheDocument();
    });

    it('clicking the inline Confirmar button does not also open the comparison dialog', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => reportWithCoincidencia })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ...coincidenciaRow, status: 'confirmado' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const inlineConfirmar = await screen.findByRole('button', { name: /^confirmar$/i });
      await act(async () => {
        await userEvent.click(inlineConfirmar);
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('RF-09: feedback previo + marks', () => {
    it('shows the prior feedback note under a row that already has one, without hiding the row', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => reportWithFeedback }) as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      expect(await screen.findByText(/pendientes en arca \(2\)/i)).toBeInTheDocument();
      expect(screen.getByText(/revisado antes/i)).toBeInTheDocument();
    });

    it('creates a "revisado" mark for a pendiente_en_arca row', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'm1', tenant_id: 't1', user_id: 'u1', composite_key: '30111111112|1|1|200', classification: 'revisado', note: null, created_at: '2026-04-01T00:00:00Z' }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const revisadoButton = await screen.findByRole('button', { name: /^revisado$/i });
      await act(async () => {
        await userEvent.click(revisadoButton);
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/api/periodos/${PERIODO_ID}/marks`),
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ composite_key: '30111111112|1|1|200', classification: 'revisado', note: null });
    });

    it('creates an "explicado" mark with a note from a window.prompt', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'm2', tenant_id: 't1', user_id: 'u1', composite_key: '30111111112|1|1|200', classification: 'explicado', note: 'diferencia de cambio', created_at: '2026-04-01T00:00:00Z' }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.spyOn(window, 'prompt').mockReturnValue('diferencia de cambio');

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const explicadoButton = await screen.findByRole('button', { name: /^explicado$/i });
      await act(async () => {
        await userEvent.click(explicadoButton);
      });

      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ composite_key: '30111111112|1|1|200', classification: 'explicado', note: 'diferencia de cambio' });
    });

    it('aborts the "explicado" mark when the prompt is cancelled', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.spyOn(window, 'prompt').mockReturnValue(null);

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const explicadoButton = await screen.findByRole('button', { name: /^explicado$/i });
      await userEvent.click(explicadoButton);

      expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial load — no POST fired
    });
  });

  describe('2026-08-23 (feature 2 de 3): "Marcar como resuelto sin pareja"', () => {
    it('resolves a pendiente_en_arca row after confirm + an optional nota', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'a2', estado: 'conciliado' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      jest.spyOn(window, 'prompt').mockReturnValue('nunca va a matchear, cargado en arca hace meses');

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const resolverButton = await screen.findByRole('button', { name: /marcar como resuelto/i });
      await act(async () => {
        await userEvent.click(resolverButton);
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/api/periodos/${PERIODO_ID}/pendientes-arca-resolver`),
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
      expect(body).toEqual({ arca_voucher_id: 'a2', nota: 'nunca va a matchear, cargado en arca hace meses' });
      expect(fetchMock).toHaveBeenCalledTimes(3); // initial load, POST, reload
    });

    it('does not call the API when the confirm dialog is cancelled', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      const promptSpy = jest.spyOn(window, 'prompt');

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const resolverButton = await screen.findByRole('button', { name: /marcar como resuelto/i });
      await userEvent.click(resolverButton);

      expect(promptSpy).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial load — no POST fired
    });

    it('aborts when confirmed but the nota prompt is cancelled', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody });
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      jest.spyOn(window, 'prompt').mockReturnValue(null);

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      const resolverButton = await screen.findByRole('button', { name: /marcar como resuelto/i });
      await userEvent.click(resolverButton);

      expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial load — no POST fired
    });

    it('only shows "Marcar como resuelto" for pendientes_en_arca rows, not posibles_coincidencias', async () => {
      // reportWithCoincidencia keeps openReportBody's single pendientes_en_arca row (a2)
      // and adds one posibles_coincidencias row — the button count must stay at 1.
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => reportWithCoincidencia }) as unknown as typeof fetch;

      render(<PeriodoReportViewer periodoId={PERIODO_ID} />);
      expect(await screen.findByText(/posible coincidencia \(1\)/i)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /marcar como resuelto/i })).toHaveLength(1);
    });
  });
});
