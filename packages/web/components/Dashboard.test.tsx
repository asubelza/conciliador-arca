import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardShell } from './Dashboard';
import { listPeriodos, getPendientesHistorico } from '../lib/api';
import type { PendientesHistoricoResult } from '../lib/api';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  listPeriodos: jest.fn(),
  getPendientesHistorico: jest.fn(),
}));

const mockedListPeriodos = listPeriodos as jest.Mock;
const mockedGetPendientesHistorico = getPendientesHistorico as jest.Mock;

const TENANT_ID = '33333333-3333-3333-3333-333333333333';

const abiertoPeriodo = {
  id: '11111111-1111-1111-1111-111111111111',
  tenant_id: TENANT_ID,
  mes: '2026-08',
  estado: 'abierto' as const,
  tolerancia_ars: null,
  cerrado_at: null,
  cerrado_por: null,
};

const cerradoPeriodo = {
  id: '22222222-2222-2222-2222-222222222222',
  tenant_id: TENANT_ID,
  mes: '2026-07',
  estado: 'cerrado' as const,
  tolerancia_ars: null,
  cerrado_at: '2026-07-31T00:00:00Z',
  cerrado_por: null,
};

const historicoVacio: PendientesHistoricoResult = {
  tenant: { id: TENANT_ID, name: 'Tenant de prueba', created_at: '2026-01-01T00:00:00Z' },
  pendientes: [],
  count_pendientes: 0,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
};

function renderDashboard(overrides: Partial<Parameters<typeof DashboardShell>[0]> = {}) {
  const props = {
    tenantId: TENANT_ID,
    userRole: 'admin' as const,
    onOpenPeriodo: jest.fn(),
    onCreatePeriodo: jest.fn(),
    onReopenPeriodo: jest.fn(),
    onDeletePeriodo: jest.fn(),
    onViewReport: jest.fn(),
    onChangeTenant: jest.fn(),
    ...overrides,
  };
  render(<DashboardShell {...props} />);
  return props;
}

beforeEach(() => {
  mockedListPeriodos.mockReset();
  mockedGetPendientesHistorico.mockReset();
});

describe('DashboardShell', () => {
  it('carga y muestra los períodos abiertos con acciones para admin', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo, cerradoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    // Período en curso (Section A)
    expect(await screen.findByRole('heading', { name: /Período en curso/i })).toBeInTheDocument();
    expect(screen.getByText('2026-08')).toBeInTheDocument();
    // Admin sees open-periodo actions
    expect(screen.getByRole('button', { name: 'Abrir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eliminar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear nuevo período/i })).toBeInTheDocument();
    // Reabrir belongs to Section B (Histórico) — only closed períodos can be reopened.
    expect(screen.getByRole('button', { name: /^Reabrir$/i })).toBeInTheDocument();
  });

  it('muestra el mensaje vacío cuando el tenant no tiene períodos', async () => {
    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    expect(await screen.findByText(/todavía no tiene períodos/i)).toBeInTheDocument();
  });

  it('cliente es de solo lectura pero puede seguir abriendo su período abierto (RF-28)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard({ userRole: 'cliente' });

    expect(await screen.findByText(/solo lectura/i)).toBeInTheDocument();
    // Cliente still SEES its open período and can open it (RF-24 round-trip) —
    // "solo lectura" only removes crear/reabrir/eliminar, not visibility.
    expect(screen.getByText('2026-08')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(props.onOpenPeriodo).toHaveBeenCalledWith(abiertoPeriodo);

    expect(screen.queryByRole('button', { name: /^Reabrir$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crear nuevo período/i })).not.toBeInTheDocument();
  });

  it('Section B: al confirmar "Reabrir" en un período cerrado invoca onReopenPeriodo (RF-28, RF-30)', async () => {
    // Reabrir solo tiene sentido sobre un período CERRADO (undo de cierre) —
    // vive en Section B (Histórico), no en Section A (abiertos).
    mockedListPeriodos.mockResolvedValue([cerradoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    await screen.findByRole('button', { name: /^Reabrir$/i });
    await userEvent.click(screen.getByRole('button', { name: /^Reabrir$/i }));
    expect(screen.getByRole('heading', { name: /Reabrir período/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    expect(props.onReopenPeriodo).toHaveBeenCalledWith(cerradoPeriodo);
  });

  it('dos períodos abiertos simultáneos se listan ambos, mes DESC (RF-25)', async () => {
    const agosto = { ...abiertoPeriodo, id: 'p-ago', mes: '2026-08' };
    const julio = { ...abiertoPeriodo, id: 'p-jul', mes: '2026-07' };
    // El backend ya devuelve ORDER BY mes DESC — el Dashboard preserva ese orden.
    mockedListPeriodos.mockResolvedValue([agosto, julio]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    await screen.findByText('2026-08');
    const meses = screen.getAllByText(/^2026-(08|07)$/).map((el) => el.textContent);
    expect(meses).toEqual(['2026-08', '2026-07']);
  });

  it('colaborador ve "Reabrir" en cerrados pero no "Eliminar" en ningún lado (RF-28)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo, cerradoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard({ userRole: 'colaborador' });

    expect(await screen.findByRole('button', { name: /^Reabrir$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument();
  });

  it('muestra un indicador de carga por sección antes de que listPeriodos resuelva (RF-29)', async () => {
    let resolveList: (value: unknown) => void = () => {};
    mockedListPeriodos.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    expect(screen.getAllByText(/Cargando/i).length).toBeGreaterThan(0);

    resolveList([abiertoPeriodo]);
    expect(await screen.findByText('2026-08')).toBeInTheDocument();
  });

  it('si listPeriodos falla, A/B muestran error con reintentar y C sigue renderizando su propio fetch (RF-29)', async () => {
    mockedListPeriodos.mockRejectedValueOnce(new Error('Períodos fetch failed (500)'));
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    alerts.forEach((alert) => expect(alert).toHaveTextContent('Períodos fetch failed (500)'));
    // Section C's own independent fetch still succeeds and renders.
    expect(await screen.findByText(/Sin pendientes ARCA/i)).toBeInTheDocument();

    mockedListPeriodos.mockResolvedValueOnce([abiertoPeriodo]);
    const [retryButton] = screen.getAllByRole('button', { name: /Reintentar/i });
    await userEvent.click(retryButton);

    expect(await screen.findByText('2026-08')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('al confirmar "Eliminar" invoca onDeletePeriodo', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    await screen.findByRole('button', { name: /Eliminar/i });
    await userEvent.click(screen.getByRole('button', { name: /Eliminar/i }));
    expect(screen.getByRole('heading', { name: /Eliminar período/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    expect(props.onDeletePeriodo).toHaveBeenCalledWith(abiertoPeriodo);
  });

  it('al hacer click en "Crear nuevo período" invoca onCreatePeriodo', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    await userEvent.click(await screen.findByRole('button', { name: /Crear nuevo período/i }));
    expect(props.onCreatePeriodo).toHaveBeenCalled();
  });

  it('Section B muestra los períodos cerrados y "Ver reporte" invoca onViewReport', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo, cerradoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    expect(await screen.findByRole('heading', { name: /Histórico/i })).toBeInTheDocument();
    const reportBtn = screen.getByRole('button', { name: /Ver reporte/i });
    await userEvent.click(reportBtn);
    expect(props.onViewReport).toHaveBeenCalledWith(cerradoPeriodo);
  });

  it('Section C con count 0 muestra "Sin pendientes ARCA" para admin', async () => {
    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    expect(await screen.findByText(/Sin pendientes ARCA/i)).toBeInTheDocument();
  });

  it('"Ver histórico completo" abre el viewer como overlay dentro del dashboard, sin salir de la ruta (RF-24, RF-27)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    await userEvent.click(await screen.findByText(/Ver histórico completo/i));

    expect(await screen.findByRole('heading', { name: /Histórico de Pendientes en ARCA/i })).toBeInTheDocument();
    // The Dashboard shell itself is swapped out for the overlay — sections
    // A/B are gone while the overlay is open (still the SAME mounted route).
    expect(screen.queryByRole('heading', { name: /Período en curso/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Volver al dashboard/i }));
    expect(await screen.findByRole('heading', { name: /Período en curso/i })).toBeInTheDocument();
  });

  it('Section C para cliente muestra el título "Pendientes ARCA" al cargar', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard({ userRole: 'cliente' });

    expect(await screen.findByRole('heading', { name: /Pendientes ARCA/i })).toBeInTheDocument();
  });

  it('Section C muestra conteos como números simples, sin símbolo de moneda', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue({
      ...historicoVacio,
      count_excluidos_previos_a_alta: 1234,
    });
    renderDashboard({ userRole: 'cliente' });

    expect(await screen.findByText(/excluidos previos a alta/i)).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
    expect(screen.queryByText(/\$1234/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$1,234/)).not.toBeInTheDocument();
  });

  it('al confirmar "Eliminar" deshabilita el diálogo mientras la mutación está en curso y lo cierra al terminar', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    let resolveDelete: () => void = () => {};
    const onDeletePeriodo = jest.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve; }));
    renderDashboard({ onDeletePeriodo });

    await userEvent.click(await screen.findByRole('button', { name: /Eliminar/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    expect(onDeletePeriodo).toHaveBeenCalledWith(abiertoPeriodo);
    // Still open and disabled while the mutation is pending — the dialog
    // must not be dismissed before the mutation settles.
    expect(screen.getByRole('button', { name: /Confirmar/i })).toBeDisabled();

    resolveDelete();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Eliminar período/i })).not.toBeInTheDocument();
    });
  });

  it('si getPendientesHistorico falla, Section C muestra error con reintentar', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockRejectedValueOnce(new Error('Pendientes históricos fetch failed'));
    renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Pendientes históricos fetch failed');

    mockedGetPendientesHistorico.mockResolvedValueOnce(historicoVacio);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    expect(await screen.findByText(/Sin pendientes ARCA/i)).toBeInTheDocument();
  });

  it('ofrece "Cambiar tenant" cuando listPeriodos falla, y lo invoca al hacer click', async () => {
    mockedListPeriodos.mockRejectedValueOnce(new Error('Períodos fetch failed (500)'));
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    const changeTenantBtn = await screen.findByRole('button', { name: /Cambiar tenant/i });
    await userEvent.click(changeTenantBtn);
    expect(props.onChangeTenant).toHaveBeenCalled();
  });

  it('ofrece "Cambiar tenant" cuando el tenant no tiene ningún período', async () => {
    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    expect(await screen.findByRole('button', { name: /Cambiar tenant/i })).toBeInTheDocument();
  });

  it('no ofrece "Cambiar tenant" cuando hay períodos cargados sin error', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    renderDashboard();

    await screen.findByText('2026-08');
    expect(screen.queryByRole('button', { name: /Cambiar tenant/i })).not.toBeInTheDocument();
  });
});

const TENANT_ID_B = '44444444-4444-4444-4444-444444444444';

function baseShellProps(tenantId: string, userRole: 'admin' | 'colaborador' | 'cliente') {
  return {
    tenantId,
    userRole,
    onOpenPeriodo: jest.fn(),
    onCreatePeriodo: jest.fn(),
    onReopenPeriodo: jest.fn(),
    onDeletePeriodo: jest.fn(),
    onViewReport: jest.fn(),
    onChangeTenant: jest.fn(),
  };
}

/**
 * Fix 6/7 (review 2026-10-11): `SectionC`'s `load` and `DashboardShell`'s
 * `refresh` are `useCallback`-wrapped async fetches with no cancellation
 * guard — a prop change (tenantId switching, same scenario as a rapid
 * "Reintentar" re-click) that re-triggers the fetch before the previous one
 * resolves could let the stale response clobber the fresher one. Both now
 * guard with a request-generation ref.
 */
describe('Fix 6/7 (2026-10-11): a stale in-flight response does not clobber a fresher one', () => {
  it('SectionC: a late pendientes-históricos response for the OLD tenant is discarded after the tenant changes', async () => {
    const historicoOld = { ...historicoVacio, count_pendientes: 1 };
    const historicoNew = { ...historicoVacio, count_pendientes: 99 };
    let resolveOld: (value: PendientesHistoricoResult) => void = () => {};

    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico
      .mockImplementationOnce(() => new Promise<PendientesHistoricoResult>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(historicoNew);

    const { rerender } = render(<DashboardShell {...baseShellProps(TENANT_ID, 'cliente')} />);
    // Switch tenants before the first (old tenant) fetch resolves — `load`
    // gets a new identity (tenantId changed), re-running the mount effect.
    rerender(<DashboardShell {...baseShellProps(TENANT_ID_B, 'cliente')} />);

    expect(await screen.findByText('99')).toBeInTheDocument();

    // The stale response for the OLD tenant arrives late.
    resolveOld(historicoOld);
    await waitFor(() => expect(mockedGetPendientesHistorico).toHaveBeenCalledTimes(2));

    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('DashboardShell: a late listPeriodos response for the OLD tenant is discarded after the tenant changes', async () => {
    const periodoOld = { ...abiertoPeriodo, mes: '2026-01' };
    const periodoNew = { ...abiertoPeriodo, mes: '2026-12' };
    let resolveOld: (value: unknown) => void = () => {};

    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    mockedListPeriodos
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce([periodoNew]);

    const { rerender } = render(<DashboardShell {...baseShellProps(TENANT_ID, 'admin')} />);
    rerender(<DashboardShell {...baseShellProps(TENANT_ID_B, 'admin')} />);

    expect(await screen.findByText('2026-12')).toBeInTheDocument();

    resolveOld([periodoOld]);
    await waitFor(() => expect(mockedListPeriodos).toHaveBeenCalledTimes(2));

    expect(screen.queryByText('2026-01')).not.toBeInTheDocument();
    expect(screen.getByText('2026-12')).toBeInTheDocument();
  });
});
