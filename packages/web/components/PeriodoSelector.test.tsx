import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodoSelector } from './PeriodoSelector';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('T30: PeriodoSelector', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a non-UUID tenant_id without calling fetch', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const onSelected = jest.fn();
    render(<PeriodoSelector onSelected={onSelected} />);

    await userEvent.type(screen.getByLabelText(/tenant id/i), 'not-a-uuid');
    await userEvent.click(screen.getByRole('button', { name: /buscar per[ií]odos/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('tenant_id is required and must be a UUID');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lists existing períodos and selects one directly', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        periodos: [
          { id: 'p-1', tenant_id: TENANT_ID, mes: '2026-04-01', estado: 'abierto', tolerancia_ars: null, cerrado_at: null, cerrado_por: null },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onSelected = jest.fn();

    render(<PeriodoSelector onSelected={onSelected} />);
    await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /buscar per[ií]odos/i }));
    });

    const periodoButton = await screen.findByRole('button', { name: /2026-04-01/i });
    await userEvent.click(periodoButton);

    expect(onSelected).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ id: 'p-1', mes: '2026-04-01', estado: 'abierto' }),
    );
  });

  it('creates a new período and selects it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ periodos: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'p-2',
          tenant_id: TENANT_ID,
          mes: '2026-05-01',
          estado: 'abierto',
          tolerancia_ars: null,
          cerrado_at: null,
          cerrado_por: null,
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onSelected = jest.fn();

    render(<PeriodoSelector onSelected={onSelected} />);
    await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /buscar per[ií]odos/i }));
    });

    expect(await screen.findByText(/todav[ií]a no tiene per[ií]odos/i)).toBeInTheDocument();

    const mesInput = screen.getByLabelText(/nuevo per[ií]odo/i);
    // type="month" inputs accept fireEvent-style value changes via userEvent.type on the ISO shape.
    await userEvent.type(mesInput, '2026-05');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /crear per[ií]odo/i }));
    });

    await waitFor(() =>
      expect(onSelected).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ id: 'p-2', mes: '2026-05-01' })),
    );
  });

  it('toggles the tenant tolerance config panel', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ periodos: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PeriodoSelector onSelected={jest.fn()} />);
    await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /buscar per[ií]odos/i }));
    });
    await screen.findByText(/todav[ií]a no tiene per[ií]odos/i);

    expect(screen.queryByLabelText(/tolerancia de redondeo/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /configurar tolerancia/i }));
    expect(await screen.findByLabelText(/tolerancia de redondeo/i)).toBeInTheDocument();
  });
});
