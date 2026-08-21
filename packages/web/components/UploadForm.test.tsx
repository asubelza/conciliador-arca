import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm } from './UploadForm';

describe('T13: UploadForm', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('RED: shows an error and does not call onUploaded when no files are selected', async () => {
    const onUploaded = jest.fn();
    render(<UploadForm onUploaded={onUploaded} />);

    await userEvent.type(screen.getByLabelText(/tenant id/i), '11111111-1111-1111-1111-111111111111');
    await userEvent.click(screen.getByRole('button', { name: /subir y conciliar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Both ARCA and contabilidad files are required');
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('shows an error when files are selected but tenant_id is blank', async () => {
    const onUploaded = jest.fn();
    render(<UploadForm onUploaded={onUploaded} />);

    const arcaFile = new File(['a'], 'arca.csv', { type: 'text/csv' });
    const contabilidadFile = new File(['a'], 'contabilidad.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/archivo arca/i), arcaFile);
    await userEvent.upload(screen.getByLabelText(/archivo contabilidad/i), contabilidadFile);
    await userEvent.click(screen.getByRole('button', { name: /subir y conciliar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('tenant_id is required and must be a UUID');
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('GREEN: uploads both files + tenant_id + source system, calls onUploaded with job_id', async () => {
    const onUploaded = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'job-123', status_url: '/api/reconciliations/job-123/status' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UploadForm onUploaded={onUploaded} />);

    await userEvent.type(screen.getByLabelText(/tenant id/i), '11111111-1111-1111-1111-111111111111');
    const arcaFile = new File(['cuit,tipo\n1,1'], 'arca.csv', { type: 'text/csv' });
    const contabilidadFile = new File(['cuit,tipo\n1,1'], 'contabilidad.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/archivo arca/i), arcaFile);
    await userEvent.upload(screen.getByLabelText(/archivo contabilidad/i), contabilidadFile);

    // handleSubmit is async (fetch → res.json(), each a microtask tick beyond
    // what userEvent.click's own act-wrapping flushes), so its state updates
    // (setSubmitting(false) in the finally block, after onUploaded) land
    // outside that window unless the whole chain is wrapped in one `act`.
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /subir y conciliar/i }));
    });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('job-123'));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/reconciliations'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the API error message when the upload request fails', async () => {
    const onUploaded = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'contabilidad_source_system is required and must be one of: tango, bejerman, xubio, contabilium' }),
    }) as unknown as typeof fetch;

    render(<UploadForm onUploaded={onUploaded} />);
    await userEvent.type(screen.getByLabelText(/tenant id/i), '11111111-1111-1111-1111-111111111111');
    const arcaFile = new File(['a'], 'arca.csv', { type: 'text/csv' });
    const contabilidadFile = new File(['a'], 'contabilidad.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/archivo arca/i), arcaFile);
    await userEvent.upload(screen.getByLabelText(/archivo contabilidad/i), contabilidadFile);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /subir y conciliar/i }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/contabilidad_source_system/);
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
