import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportViewer } from './ReportViewer';

describe('T13: ReportViewer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches and renders the diff report rows + download links', async () => {
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
    expect(screen.getByRole('link', { name: /descargar csv/i })).toHaveAttribute(
      'href',
      expect.stringContaining('format=csv'),
    );
    expect(screen.getByRole('link', { name: /descargar excel/i })).toHaveAttribute(
      'href',
      expect.stringContaining('format=xlsx'),
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
