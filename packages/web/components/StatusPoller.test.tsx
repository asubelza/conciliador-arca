import { render, screen, waitFor } from '@testing-library/react';
import { StatusPoller } from './StatusPoller';

describe('T13: StatusPoller', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('polls until completed and calls onCompleted', async () => {
    let call = 0;
    const fetchMock = jest.fn().mockImplementation(() => {
      call += 1;
      const body =
        call < 2 ? { status: 'processing' } : { status: 'completed', counts: { arca_rows: 5, contabilidad_rows: 3 } };
      return Promise.resolve({ ok: true, json: async () => body });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onCompleted = jest.fn();
    render(<StatusPoller jobId="job-1" onCompleted={onCompleted} pollIntervalMs={10} />);

    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(await screen.findByText(/reconciliación completa/i)).toBeInTheDocument();
    expect(screen.getByText(/ARCA: 5, Contabilidad: 3/)).toBeInTheDocument();
  });

  it('shows the failure detail when the job errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error', detail: 'Archivo corrupto' }),
    }) as unknown as typeof fetch;

    const onCompleted = jest.fn();
    render(<StatusPoller jobId="job-2" onCompleted={onCompleted} pollIntervalMs={10} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Archivo corrupto');
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('shows a network/API error without crashing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Reconciliation job not found' }),
    }) as unknown as typeof fetch;

    render(<StatusPoller jobId="unknown-job" onCompleted={jest.fn()} pollIntervalMs={10} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Reconciliation job not found');
  });
});
