import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodoReportViewer } from './PeriodoReportViewer';

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
      },
    ],
  },
};

describe('T31: PeriodoReportViewer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches and renders the 3 sections, with antigüedad_meses in Pendientes en ARCA', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => openReportBody }) as unknown as typeof fetch;

    render(<PeriodoReportViewer periodoId={PERIODO_ID} />);

    expect(await screen.findByText(/conciliados ok \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/pendientes en arca \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // antiguedad_meses cell
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
});
