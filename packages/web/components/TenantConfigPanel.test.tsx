import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantConfigPanel } from './TenantConfigPanel';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('T32: TenantConfigPanel', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads and displays the current tolerance', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: TENANT_ID, tolerancia_redondeo_ars: '0.99' }),
    }) as unknown as typeof fetch;

    render(<TenantConfigPanel tenantId={TENANT_ID} />);

    expect(await screen.findByDisplayValue('0.99')).toBeInTheDocument();
  });

  it('saves an updated tolerance via PUT', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: TENANT_ID, tolerancia_redondeo_ars: '0.99' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: TENANT_ID, tolerancia_redondeo_ars: '2.50' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<TenantConfigPanel tenantId={TENANT_ID} />);
    const input = await screen.findByDisplayValue('0.99');
    await userEvent.clear(input);
    await userEvent.type(input, '2.50');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    });

    await waitFor(() => expect(screen.getByText(/guardado/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/config'),
      expect.objectContaining({ method: 'PUT' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.tolerancia_redondeo_ars).toBe(2.5);
  });

  it('shows an error for a negative tolerance instead of saving', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: TENANT_ID, tolerancia_redondeo_ars: '0.99' }),
    }) as unknown as typeof fetch;

    render(<TenantConfigPanel tenantId={TENANT_ID} />);
    const input = await screen.findByDisplayValue('0.99');
    // userEvent.type on a type="number" input is flaky with a leading "-"
    // across jsdom versions (the sanitization algorithm can drop the
    // in-progress partial value between keystrokes) — fireEvent.change sets
    // the final value in one shot, which is all this test needs.
    fireEvent.change(input, { target: { value: '-5' } });
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('non-negative');
  });
});
