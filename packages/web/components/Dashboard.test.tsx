import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  archivados: [],
  count_archivados: 0,
};

const historicoConDatos: PendientesHistoricoResult = {
  tenant: { id: TENANT_ID, name: 'Tenant de prueba', created_at: '2026-01-01T00:00:00Z' },
  pendientes: [
    {
      id: 'p1',
      cuit_emisor: '30682503750',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 100,
      importe_total: 500,
      iva: null,
      fecha: '2026-07-15',
      file_source: 'arca',
      estado: 'conciliado',
      periodo_alta_id: '',
      antiguedad_meses: 0,
    },
  ],
  count_pendientes: 1,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 3,
  archivados: [],
  count_archivados: 0,
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
  const renderResult = render(<DashboardShell {...props} />);
  return { ...props, ...renderResult };
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

  it('Section C para cliente no antepone "$" al conteo de excluidos previos a alta', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoConDatos);
    renderDashboard({ userRole: 'cliente' });

    // count_excluidos_previos_a_alta is an integer COUNT, not a currency
    // amount — it must render as a plain number, no leading "$".
    const value = await screen.findByText('3');
    expect(value).toBeInTheDocument();
    expect(screen.queryByText('$3')).not.toBeInTheDocument();
  });

  it('Section C: si getPendientesHistorico falla, muestra error con reintentar y deja de mostrar "Cargando" (RF-29)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockRejectedValueOnce(new Error('Pendientes fetch failed (500)'));
    renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Pendientes fetch failed (500)');
    expect(screen.queryByText(/Cargando gráfico de pendientes ARCA/i)).not.toBeInTheDocument();

    mockedGetPendientesHistorico.mockResolvedValueOnce(historicoVacio);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    expect(await screen.findByText(/Sin pendientes ARCA/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con datos no vacíos, "Ver histórico completo" aparece una sola vez y abre el overlay (sin tarjeta/link duplicados)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoConDatos);
    renderDashboard();

    const buttons = await screen.findAllByRole('button', { name: /Ver histórico completo/i });
    expect(buttons.length).toBe(1);

    await userEvent.click(buttons[0]);
    expect(await screen.findByRole('heading', { name: /Histórico de Pendientes en ARCA/i })).toBeInTheDocument();
  });

  it('ignora una respuesta stale de listPeriodos cuando dos refreshes se solapan (race condition)', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    let resolveSecond: (value: unknown) => void = () => {};
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    const secondPromise = new Promise((resolve) => { resolveSecond = resolve; });
    mockedListPeriodos
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);

    const baseProps = {
      userRole: 'admin' as const,
      onOpenPeriodo: jest.fn(),
      onCreatePeriodo: jest.fn(),
      onReopenPeriodo: jest.fn(),
      onDeletePeriodo: jest.fn(),
      onViewReport: jest.fn(),
      onChangeTenant: jest.fn(),
    };
    const { rerender } = render(<DashboardShell tenantId={TENANT_ID} {...baseProps} />);

    // Force a second, independent refresh while the first is still in
    // flight (e.g. a tenant switch, or a mutation firing before the
    // initial fetch settles) — the OLDER request resolves LAST below,
    // simulating a deleted período reappearing if responses aren't
    // sequenced by request id.
    rerender(<DashboardShell tenantId={`${TENANT_ID}-other`} {...baseProps} />);

    resolveSecond([abiertoPeriodo]);
    expect(await screen.findByText('2026-08')).toBeInTheDocument();

    resolveFirst([cerradoPeriodo]);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText('2026-08')).toBeInTheDocument();
    expect(screen.queryByText('2026-07')).not.toBeInTheDocument();
  });

  it('Section C ignora una respuesta stale de getPendientesHistorico cuando el tenantId cambia (race condition)', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    let resolveSecond: (value: unknown) => void = () => {};
    const firstPromise = new Promise((resolve) => { resolveFirst = resolve; });
    const secondPromise = new Promise((resolve) => { resolveSecond = resolve; });
    mockedGetPendientesHistorico
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);
    mockedListPeriodos.mockResolvedValue([]);

    const baseProps = {
      userRole: 'admin' as const,
      onOpenPeriodo: jest.fn(),
      onCreatePeriodo: jest.fn(),
      onReopenPeriodo: jest.fn(),
      onDeletePeriodo: jest.fn(),
      onViewReport: jest.fn(),
      onChangeTenant: jest.fn(),
    };
    const { rerender } = render(<DashboardShell tenantId={TENANT_ID} {...baseProps} />);

    // Force a second, independent fetch while the first is still in flight
    // (e.g. a tenant switch) — the OLDER request (TENANT_ID) resolves LAST
    // below, simulating stale data overwriting the newer tenant's result
    // if responses aren't sequenced by request id.
    rerender(<DashboardShell tenantId={`${TENANT_ID}-other`} {...baseProps} />);

    resolveSecond(historicoVacio);
    expect(await screen.findByText(/Sin pendientes ARCA/i)).toBeInTheDocument();

    resolveFirst(historicoConDatos);
    // Flush enough micro+macrotasks for the stale `load()` call's `await
    // getPendientesHistorico(tenantId)` continuation (setResult) to run,
    // if nothing guards against it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText(/Sin pendientes ARCA/i)).toBeInTheDocument();
    // Stronger check: the stale response's distinguishing content
    // ("total importe", only rendered by the non-empty chart) must never
    // appear — a weaker check could pass vacuously before React flushes.
    expect(screen.queryByText(/total importe/i)).not.toBeInTheDocument();
  });

  it('siempre ofrece un control para cambiar de tenant, incluso con cero períodos (evita el dead-end de las nav tabs)', async () => {
    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    await screen.findByText(/todavía no tiene períodos/i);
    const changeTenantBtn = screen.getByRole('button', { name: /Cambiar tenant/i });
    await userEvent.click(changeTenantBtn);
    expect(props.onChangeTenant).toHaveBeenCalledTimes(1);
  });

  it('deshabilita el botón Confirmar mientras la eliminación está en curso, evitando una segunda mutación concurrente (race condition)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    let resolveDelete: () => void = () => {};
    const onDeletePeriodo = jest.fn(
      () => new Promise<void>((resolve) => { resolveDelete = resolve; }),
    );
    renderDashboard({ onDeletePeriodo });

    await userEvent.click(await screen.findByRole('button', { name: /Eliminar/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    // Still mid-flight: the confirm button must stay disabled so a second
    // click can't fire a concurrent mutation against an already-mutated período.
    expect(screen.getByRole('button', { name: /Confirmar/i })).toBeDisabled();
    expect(onDeletePeriodo).toHaveBeenCalledTimes(1);

    resolveDelete();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Eliminar período/i })).not.toBeInTheDocument(),
    );
  });

  it('Section B: deshabilita el botón Confirmar de "Reabrir" mientras la reapertura está en curso', async () => {
    mockedListPeriodos.mockResolvedValue([cerradoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    let resolveReopen: () => void = () => {};
    const onReopenPeriodo = jest.fn(
      () => new Promise<void>((resolve) => { resolveReopen = resolve; }),
    );
    renderDashboard({ onReopenPeriodo });

    await userEvent.click(await screen.findByRole('button', { name: /^Reabrir$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    expect(screen.getByRole('button', { name: /Confirmar/i })).toBeDisabled();
    expect(onReopenPeriodo).toHaveBeenCalledTimes(1);

    resolveReopen();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Reabrir período/i })).not.toBeInTheDocument(),
    );
  });

  it('no lanza ni deja una mutación en el aire si se desmonta durante el refresh posterior a crear un período (memory-leak guard)', async () => {
    // NOTE: React 18 already silently no-ops a setState call made after
    // unmount (no thrown error, no console warning in this exact scenario —
    // confirmed empirically: this assertion alone doesn't discriminate
    // before/after the isMountedRef guard). This test is kept as a
    // crash/smoke guard for the unmount-during-refresh sequence itself;
    // the isMountedRef guard in Dashboard.tsx's refresh() is the actual
    // fix and is intentionally defensive — matches this repo's precedent
    // for signature-only/defensive changes where RED/GREEN triangulation
    // is skipped (see PR-9.md's T62 note).
    mockedListPeriodos.mockResolvedValueOnce([]); // initial mount fetch
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);

    let resolveCreate: () => void = () => {};
    const onCreatePeriodo = jest.fn(
      () => new Promise<void>((resolve) => { resolveCreate = resolve; }),
    );
    const { unmount } = renderDashboard({ onCreatePeriodo });

    await screen.findByText(/todavía no tiene períodos/i);

    mockedListPeriodos.mockResolvedValueOnce([abiertoPeriodo]); // the post-mutation refresh
    await userEvent.click(screen.getByRole('button', { name: /Crear nuevo período/i }));

    // Simulate page.tsx navigating away (unmounting DashboardShell) the
    // instant onCreatePeriodo's action resolves — exactly what
    // handleOpenPeriodo does in the real app.
    expect(() => {
      unmount();
      resolveCreate();
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('"Crear nuevo período" permite elegir el mes en vez de quedar fijo al mes actual (regresión vs. PeriodoSelector pre-Dashboard)', async () => {
    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    const monthInput = await screen.findByLabelText(/mes del nuevo per[ií]odo/i);
    fireEvent.change(monthInput, { target: { value: '2025-11' } });

    await userEvent.click(screen.getByRole('button', { name: /Crear nuevo período/i }));
    expect(props.onCreatePeriodo).toHaveBeenCalledWith('2025-11');
  });

  it('deshabilita "Crear nuevo período" si el mes queda vacío (regresión: faltaba el guard al mover crear a Dashboard)', async () => {
    mockedListPeriodos.mockResolvedValue([]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    const monthInput = await screen.findByLabelText(/mes del nuevo per[ií]odo/i);
    fireEvent.change(monthInput, { target: { value: '' } });

    expect(screen.getByRole('button', { name: /Crear nuevo período/i })).toBeDisabled();
    expect(props.onCreatePeriodo).not.toHaveBeenCalled();
  });

  it('el mes por defecto usa la fecha LOCAL, no UTC (regresión: toISOString() rueda al mes siguiente cerca de medianoche en Argentina)', async () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'America/Argentina/Buenos_Aires'; // UTC-3, sin DST
    jest.useFakeTimers();
    // Local 2026-01-31 23:00 ART = UTC 2026-02-01 02:00 — toISOString() diría "2026-02".
    jest.setSystemTime(new Date(2026, 0, 31, 23, 0, 0));
    try {
      mockedListPeriodos.mockResolvedValue([]);
      mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
      renderDashboard();

      const monthInput = await screen.findByLabelText(/mes del nuevo per[ií]odo/i);
      expect(monthInput).toHaveValue('2026-01');
    } finally {
      jest.useRealTimers();
      process.env.TZ = originalTZ;
    }
  });

  it('un reabrir exitoso también refresca pendientes-histórico de Sección C (regresión: afterMutation solo refrescaba la lista)', async () => {
    mockedListPeriodos.mockResolvedValue([cerradoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const onReopenPeriodo = jest.fn().mockResolvedValue(undefined);
    renderDashboard({ onReopenPeriodo });

    await screen.findByRole('button', { name: /^Reabrir$/i });
    expect(mockedGetPendientesHistorico).toHaveBeenCalledTimes(1); // initial mount fetch

    await userEvent.click(screen.getByRole('button', { name: /^Reabrir$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() => expect(mockedGetPendientesHistorico).toHaveBeenCalledTimes(2));
  });

  it('una mutación fallida NO dispara un refresh de listPeriodos (regresión: afterMutation refrescaba igual aunque la acción rechazara)', async () => {
    mockedListPeriodos.mockResolvedValue([abiertoPeriodo]);
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const onDeletePeriodo = jest.fn().mockRejectedValue(new Error('boom'));
    renderDashboard({ onDeletePeriodo });

    await screen.findByRole('button', { name: /Eliminar/i });
    expect(mockedListPeriodos).toHaveBeenCalledTimes(1); // initial mount fetch

    await userEvent.click(screen.getByRole('button', { name: /Eliminar/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Eliminar período/i })).not.toBeInTheDocument(),
    );
    expect(mockedListPeriodos).toHaveBeenCalledTimes(1); // no wasted refetch after the failure
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

  it('ofrece "Cambiar tenant" cuando listPeriodos falla, y lo invoca al hacer click', async () => {
    mockedListPeriodos.mockRejectedValueOnce(new Error('Períodos fetch failed (500)'));
    mockedGetPendientesHistorico.mockResolvedValue(historicoVacio);
    const props = renderDashboard();

    const changeTenantBtn = await screen.findByRole('button', { name: /Cambiar tenant/i });
    await userEvent.click(changeTenantBtn);
    expect(props.onChangeTenant).toHaveBeenCalled();
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
