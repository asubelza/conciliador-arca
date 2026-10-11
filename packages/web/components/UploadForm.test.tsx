import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm } from './UploadForm';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PERIODO_ID = '22222222-2222-2222-2222-222222222222';

const PREVIEW_BODY = {
  arca: {
    total: 1,
    ok: 1,
    errors: 0,
    rows: [{ ok: true, cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, fecha_emision: '2026-04-01', importe_total_ars: 1000 }],
  },
  contabilidad: {
    total: 1,
    ok: 1,
    errors: 0,
    rows: [{ ok: true, cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, fecha_emision: '2026-04-01', importe_total_ars: 1000 }],
  },
};

async function selectBothFiles() {
  const arcaFile = new File(['cuit,tipo\n1,1'], 'arca.csv', { type: 'text/csv' });
  const contabilidadFile = new File(['cuit,tipo\n1,1'], 'contabilidad.csv', { type: 'text/csv' });
  await userEvent.upload(screen.getByLabelText(/archivo arca/i), arcaFile);
  await userEvent.upload(screen.getByLabelText(/archivo contabilidad/i), contabilidadFile);
}

/**
 * T13/T30/T37: rediseño en 2 pasos (pedido del cliente, 2026-08-23, feature
 * 1 de 3) — "Previsualizar" ahora llama a POST /api/reconciliations/preview
 * primero; sólo "Confirmar y conciliar" en el paso 2 llama al endpoint real
 * de carga. Cambio de comportamiento intencional respecto a la versión
 * anterior (un solo paso, un solo click) — ver estado_dev_y_revision_pr1.md.
 */
describe('T13/T30/T37: UploadForm (flujo de 2 pasos)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('RED: shows an error and does not call preview/onUploaded when no files are selected', async () => {
    const onUploaded = jest.fn();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<UploadForm tenantId={TENANT_ID} periodoId={PERIODO_ID} onUploaded={onUploaded} />);

    await userEvent.click(screen.getByRole('button', { name: /previsualizar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Both ARCA and contabilidad files are required');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('GREEN: previews both files scoped to tenantId/periodoId, then renders FilePreviewTable', async () => {
    const onUploaded = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => PREVIEW_BODY });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UploadForm tenantId={TENANT_ID} periodoId={PERIODO_ID} onUploaded={onUploaded} />);
    await selectBothFiles();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /previsualizar/i }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/reconciliations/preview'),
      expect.objectContaining({ method: 'POST' }),
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('tenant_id')).toBe(TENANT_ID);
    expect(body.get('periodo_id')).toBe(PERIODO_ID);

    expect(await screen.findByText('Previsualización')).toBeInTheDocument();
    expect(screen.getByText('Archivo ARCA')).toBeInTheDocument();
    // Same CUIT fixture value is used on both sides of PREVIEW_BODY.
    expect(screen.getAllByText('30111111112')).toHaveLength(2);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('confirming the preview reuses the same files against the real upload endpoint and calls onUploaded', async () => {
    const onUploaded = jest.fn();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => PREVIEW_BODY })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'job-123', status_url: '/api/reconciliations/job-123/status' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UploadForm tenantId={TENANT_ID} periodoId={PERIODO_ID} onUploaded={onUploaded} />);
    await selectBothFiles();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /previsualizar/i }));
    });
    expect(await screen.findByText('Previsualización')).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /confirmar y conciliar/i }));
    });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('job-123'));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/reconciliations'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock.mock.calls[1][0]).not.toMatch(/\/preview$/);
    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect(body.get('tenant_id')).toBe(TENANT_ID);
    expect((body.get('arca_file') as File).name).toBe('arca.csv');
    expect((body.get('contabilidad_file') as File).name).toBe('contabilidad.csv');
  });

  it('"Volver" discards the preview and returns to the file-selection step', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => PREVIEW_BODY });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UploadForm tenantId={TENANT_ID} periodoId={PERIODO_ID} onUploaded={jest.fn()} />);
    await selectBothFiles();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /previsualizar/i }));
    });
    expect(await screen.findByText('Previsualización')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.queryByText('Previsualización')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previsualizar/i })).toBeInTheDocument();
  });

  it('shows the API error message when the preview request fails', async () => {
    const onUploaded = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'contabilidad_source_system is required and must be one of: tango, bejerman, xubio, contabilium' }),
    }) as unknown as typeof fetch;

    render(<UploadForm tenantId={TENANT_ID} periodoId={PERIODO_ID} onUploaded={onUploaded} />);
    await selectBothFiles();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /previsualizar/i }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/contabilidad_source_system/);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('shows the API error message when confirming the real upload fails', async () => {
    const onUploaded = jest.fn();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => PREVIEW_BODY })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'período is closed' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<UploadForm tenantId={TENANT_ID} periodoId={PERIODO_ID} onUploaded={onUploaded} />);
    await selectBothFiles();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /previsualizar/i }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /confirmar y conciliar/i }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/período is closed/);
    expect(onUploaded).not.toHaveBeenCalled();
    // Stays on the preview step (doesn't silently drop back to step 1) so the contador can retry Confirmar without re-selecting files.
    expect(screen.getByText('Previsualización')).toBeInTheDocument();
  });
});
