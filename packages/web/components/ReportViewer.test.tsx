import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportViewer } from './ReportViewer';
import { clearSession, setSession } from '@/lib/session';

/**
 * T39 (Fase 3, autenticacion-roles): every report/export endpoint now
 * requires a bearer token, so the CSV/Excel links became buttons that fetch
 * with the token and hand the browser a blob (lib/api.ts's
 * downloadAuthenticated) instead of plain `<a href>` navigation — a bare
 * href can't carry an Authorization header, and the endpoints 401 without
 * one since Fase 2. jsdom doesn't implement URL.createObjectURL, so tests
 * that click a download button stub it.
 */
describe('T13: ReportViewer', () => {
  beforeEach(() => {
    setSession('fake-token', { id: 'u1', email: 'admin@example.com', role: 'admin', display_name: null, estudio_id: 'test-estudio-id' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('fetches and renders the diff report rows + download buttons', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          {
            classification: 'matched',
            composite_key: 'k1',
            arca_importe: 1500,
            contabilidad_importe: 1499,
            delta: 1,
            iva_amount: 21,
            cae: null,
            fecha_emision: null,
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<ReportViewer jobId="job-1" />);

    expect(await screen.findByText('k1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descargar csv/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descargar excel/i })).toBeInTheDocument();
  });

  it('downloads the CSV report via an authenticated fetch when clicked', async () => {
    const csvBlob = { type: 'text/csv' };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'attachment; filename="reconciliation-job-1.csv"' },
        blob: async () => csvBlob,
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');
    window.URL.revokeObjectURL = jest.fn();
    // jsdom doesn't implement the <a download> save-file behavior — a real
    // click() would try to actually navigate and log a harmless but noisy
    // "not implemented: navigation" error. Stub click() itself since the
    // assertions below only care that fetch/createObjectURL were called
    // correctly, not that jsdom can simulate a browser download.
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ReportViewer jobId="job-1" />);
    const csvButton = await screen.findByRole('button', { name: /descargar csv/i });
    await act(async () => {
      await userEvent.click(csvButton);
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/reconciliations/job-1/report?format=csv'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }) }),
    );
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(csvBlob);
  });

  it('2026-08-23 ("Ver pendientes sistema"): toggles the table to only unmatched-contabilidad rows, and passes classification through on download', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            { classification: 'matched', composite_key: 'k1', arca_importe: 100, contabilidad_importe: 100, delta: 0, iva_amount: 21, cae: null, fecha_emision: null },
            { classification: 'unmatched-contabilidad', composite_key: 'k2', arca_importe: null, contabilidad_importe: 50, delta: null, iva_amount: 10, cae: null, fecha_emision: null },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'attachment; filename="reconciliation-job-1.csv"' },
        blob: async () => ({ type: 'text/csv' }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');
    window.URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ReportViewer jobId="job-1" />);
    expect(await screen.findByText('k1')).toBeInTheDocument();
    expect(screen.getByText('k2')).toBeInTheDocument();

    const toggleButton = screen.getByRole('button', { name: /ver pendientes sistema/i });
    await act(async () => {
      await userEvent.click(toggleButton);
    });

    expect(screen.queryByText('k1')).not.toBeInTheDocument();
    expect(screen.getByText('k2')).toBeInTheDocument();

    const csvButton = screen.getByRole('button', { name: /descargar csv/i });
    await act(async () => {
      await userEvent.click(csvButton);
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/reconciliations/job-1/report?format=csv&classification=unmatched-contabilidad'),
      expect.anything(),
    );
  });

  it('shows an empty state when there are no diff rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) }) as unknown as typeof fetch;

    render(<ReportViewer jobId="job-1" />);

    expect(await screen.findByText(/sin diferencias/i)).toBeInTheDocument();
  });

  it('lets the user mark a row as explicado', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            {
              classification: 'unmatched-arca',
              composite_key: 'k2',
              arca_importe: 100,
              contabilidad_importe: null,
              delta: null,
              iva_amount: 10,
              cae: null,
              fecha_emision: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'mark-1',
          tenant_id: 't',
          user_id: null,
          composite_key: 'k2',
          classification: 'explicado',
          note: null,
          created_at: 'now',
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(window, 'prompt').mockReturnValue(null);

    render(<ReportViewer jobId="job-1" />);
    const explicadoButton = await screen.findByRole('button', { name: /marcar como explicado/i });
    // See UploadForm.test.tsx for why the click on an async-submit handler
    // needs its own act() — the POST → res.json() chain settles a tick or
    // two after userEvent.click's own act-wrapping window closes.
    await act(async () => {
      await userEvent.click(explicadoButton);
    });

    await waitFor(() => expect(screen.getByText('explicado')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/marks'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the API error message when the mark request fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            {
              classification: 'unmatched-arca',
              composite_key: 'k3',
              arca_importe: 100,
              contabilidad_importe: null,
              delta: null,
              iva_amount: 10,
              cae: null,
              fecha_emision: null,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'composite_key is required' }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ReportViewer jobId="job-1" />);
    const revisadoButton = await screen.findByRole('button', { name: /marcar como revisado/i });
    await act(async () => {
      await userEvent.click(revisadoButton);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('composite_key is required');
  });
});
