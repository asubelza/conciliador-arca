import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setSession, clearSession } from '@/lib/session';
import Home from './page';

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const TENANT_NAME = 'Tenant de prueba';
const PERIODO_ID = '44444444-4444-4444-4444-444444444444';
const MY_TENANTS_URL = '/api/auth/me/tenants';
const myTenantsResponse = () => Promise.resolve({ ok: true, json: async () => [{ id: TENANT_ID, name: TENANT_NAME }] });

const cerradoPeriodo = {
  id: PERIODO_ID,
  tenant_id: TENANT_ID,
  mes: '2026-08-01',
  estado: 'cerrado',
  tolerancia_ars: null,
  cerrado_at: '2026-08-23T00:00:00Z',
  cerrado_por: null,
};

const abiertoPeriodo = {
  id: '55555555-5555-5555-5555-555555555555',
  tenant_id: TENANT_ID,
  mes: '2026-08-01',
  estado: 'abierto',
  tolerancia_ars: null,
  cerrado_at: null,
  cerrado_por: null,
};

const periodoReportBody = {
  periodo: cerradoPeriodo,
  live: false,
  sections: {
    conciliados_ok: [
      {
        classification: 'conciliado_ok',
        composite_key: '30111111112|1|1|100',
        sistema: { id: 's1', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, importe_total: 1000, iva: null, fecha: null, file_source: 'contabilidad', estado: 'conciliado', periodo_alta_id: PERIODO_ID },
        arca: { id: 'a1', cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, importe_total: 1000, iva: null, fecha: null, file_source: 'arca', estado: 'conciliado', periodo_alta_id: PERIODO_ID },
        divergencia_ars: null,
        antiguedad_meses: null,
        similarity_reason: null,
        feedback_previo: null,
      },
    ],
    discrepancias_y_alertas: [],
    pendientes_en_arca: [],
    posibles_coincidencias: [],
  },
};

const pendientesHistoricoBody = {
  tenant: { id: TENANT_ID, name: 'Tenant de prueba', created_at: '2026-01-01T00:00:00Z' },
  pendientes: [],
  count_pendientes: 0,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
  archivados: [],
  count_archivados: 0,
};

type MockPeriodo = {
  id: string;
  tenant_id: string;
  mes: string;
  estado: string;
  tolerancia_ars: null | string;
  cerrado_at: string | null;
  cerrado_por: null | string;
};

function mockFetchByUrl(periodos: MockPeriodo[] = [cerradoPeriodo]) {
  return jest.fn((input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes(MY_TENANTS_URL)) {
      return myTenantsResponse();
    }
    if (url.includes('/api/periodos?tenant_id=')) {
      return Promise.resolve({ ok: true, json: async () => ({ periodos }) });
    }
    if (url.includes(`/api/periodos/${PERIODO_ID}/report`)) {
      return Promise.resolve({ ok: true, json: async () => periodoReportBody });
    }
    if (url.includes(`/api/tenants/${TENANT_ID}/pendientes-historico`)) {
      return Promise.resolve({ ok: true, json: async () => pendientesHistoricoBody });
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

/**
 * T39 (Fase 3, autenticacion-roles): the top-level auth gate — `Home`
 * renders `<LoginForm />` with no session, and the real app (starting with
 * PeriodoSelector, plus the logged-in user's email/role + "Cerrar sesión")
 * once one exists. Everything past that gate (upload flow, período report,
 * role-hidden UI) is covered by each component's own test file.
 */
describe('T39: app/page.tsx (auth gate)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('shows the login form when there is no session', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /conciliador inteligente de comprobantes/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
  });

  it('shows the main app + user info + logout once a session exists', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });
    render(<Home />);

    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it('does not leak the session from the previous test into a fresh render', () => {
    // Regression: afterEach must clear the session set by the previous
    // test — session state lives in a module-level variable + localStorage
    // (lib/session.ts), neither of which Jest resets automatically between
    // tests in the same file.
    render(<Home />);
    expect(screen.getByRole('heading', { name: /conciliador inteligente de comprobantes/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
  });
});

/**
 * Backoffice self-service (invitación por email, PR4): the `?invite_token=`
 * check must win even over an existing session (approved plan, decision 5)
 * — SetPasswordPage.tsx itself is tested in isolation
 * (SetPasswordPage.test.tsx); this only proves app/page.tsx's own
 * precedence/gating around it.
 */
describe('backoffice self-service: ?invite_token= precedence over the login/session gate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
    window.history.pushState({}, '', '/');
  });

  it('shows SetPasswordPage instead of LoginForm when there is no session but an invite_token is present', async () => {
    window.history.pushState({}, '', `/?invite_token=${'a'.repeat(64)}`);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) }) as unknown as typeof fetch;

    render(<Home />);

    expect(await screen.findByRole('heading', { name: 'Activar tu cuenta' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
  });

  it('shows SetPasswordPage instead of the main app when an invite_token is present even with an active session', async () => {
    window.history.pushState({}, '', `/?invite_token=${'a'.repeat(64)}`);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'invitee@example.com', display_name: null }) }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);

    expect(await screen.findByRole('heading', { name: 'Activar tu cuenta' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
  });

  it('with no invite_token in the URL, a session goes straight to the main app as before', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);

    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();
  });
});

/**
 * Backoffice self-service (PR4): the "Backoffice" header button is
 * admin-only and swaps the whole tenant/período flow for BackofficeView —
 * BackofficeView's own tabs are covered in BackofficeView.test.tsx, this
 * only proves the admin-only visibility and the swap.
 */
describe('backoffice self-service: admin-only "Backoffice" header button', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('is visible for an admin and swaps the tenant/período flow for BackofficeView', async () => {
    global.fetch = jest.fn((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(MY_TENANTS_URL)) return myTenantsResponse();
      return Promise.resolve({ ok: true, json: async () => [] });
    }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Backoffice' }));
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
    expect(await screen.findByText('No hay tenants todavía.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();
  });

  it('is hidden for a non-admin role', () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-2', { id: 'u2', email: 'colab@estudio.com', role: 'colaborador', display_name: 'Colaborador', estudio_id: 'test-estudio-id' });

    render(<Home />);
    expect(screen.queryByRole('button', { name: 'Backoffice' })).not.toBeInTheDocument();
  });

  it('regression: does not leak BackofficeView to a non-admin who logs in right after an admin toggled it on, in the same tab', async () => {
    // `showBackoffice` is local component state — clearSession()/setSession()
    // only change the session snapshot, they don't unmount Home or reset
    // this state, so the render itself (not just the header button) must
    // re-check the role every time.
    global.fetch = jest.fn((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(MY_TENANTS_URL)) return myTenantsResponse();
      return Promise.resolve({ ok: true, json: async () => [] });
    }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Backoffice' }));
    expect(await screen.findByText('No hay tenants todavía.')).toBeInTheDocument();

    clearSession();
    setSession('tok-2', { id: 'u2', email: 'colab@estudio.com', role: 'colaborador', display_name: 'Colaborador', estudio_id: 'test-estudio-id' });

    await waitFor(() => expect(screen.queryByText('No hay tenants todavía.')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Backoffice' })).not.toBeInTheDocument();
  });
});

/**
 * Multi-estudio pivot (PR8): platform-level staff (estudio_id === null) has
 * nothing to do with the tenant/período flow — PlatformView replaces it
 * entirely rather than toggling alongside it like BackofficeView does.
 * PlatformEstudios' own list/create/toggle/invite behavior is covered in
 * PlatformEstudios.test.tsx; this only proves app/page.tsx's own branching.
 */
describe('multi-estudio pivot: platform-level staff (estudio_id null) sees PlatformView, not the tenant/período flow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('renders PlatformView instead of PeriodoSelector for a platform admin, with no "Backoffice" toggle button', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'platform-admin@example.com', role: 'admin', display_name: 'Plataforma', estudio_id: null });

    render(<Home />);

    expect(await screen.findByText('No hay estudios todavía.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Backoffice' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo estudio' })).toBeInTheDocument();
  });

  it('renders PlatformView read-only for a platform colaborador', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    setSession('tok-2', { id: 'u2', email: 'platform-colab@example.com', role: 'colaborador', display_name: 'Colaborador Plataforma', estudio_id: null });

    render(<Home />);

    expect(await screen.findByText('No hay estudios todavía.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo estudio' })).not.toBeInTheDocument();
  });

  it("an estudio's own admin (estudio_id set) still sees the normal tenant/período flow + Backoffice button, not PlatformView", async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-3', { id: 'u3', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);

    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Backoffice' })).toBeInTheDocument();
    expect(screen.queryByText('No hay estudios todavía.')).not.toBeInTheDocument();
  });
});

/**
 * AD-6 (dashboard-principal): PeriodoSelector now only yields a tenantId —
 * período selection happens through Dashboard's own sections A/B. This
 * helper walks: paste UUID -> Ingresar -> Continuar al dashboard, landing
 * on the Dashboard shell (RF-24's "UUID paste step MUST remain exactly as
 * today").
 */
async function enterTenant() {
  const select = await screen.findByLabelText(/tenant/i);
  await userEvent.selectOptions(select, TENANT_ID);
  await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
  await userEvent.click(await screen.findByRole('button', { name: /continuar al dashboard/i }));
}

/**
 * 2026-08-23: regression test for a real bug the client hit testing on
 * their own machine — "hice clic [en 'Ver histórico de pendientes ARCA']
 * y no me mostro lo que debe mostrar". The button DID toggle state, but
 * PendientesHistoricoViewer was rendered stacked BELOW the full período
 * report (which can run to hundreds of rows) instead of replacing it, so
 * the new content landed far past the fold — indistinguishable from
 * "nothing happened" without scrolling. Fixed by making the toggle swap
 * the period report for the histórico view instead of stacking below it.
 */
describe('2026-08-23: "Ver histórico de pendientes ARCA" swaps the period report, not stacks below it', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('replaces the período report with PendientesHistoricoViewer on click, and restores it on toggle-off', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);

    await enterTenant();
    // "Ver reporte" (Dashboard Section B) round-trips straight into the
    // circuit view for a cerrado período (RF-26) — no extra tab click needed.
    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));

    // cerrado período: the report shows by default, no scrolling needed.
    expect(await screen.findByText(/conciliados ok \(1\)/i)).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /ver histórico de pendientes arca/i });
    await userEvent.click(toggle);

    // The swap must be immediate — the period report is gone, not just
    // pushed below new content.
    await waitFor(() => {
      expect(screen.queryByText(/conciliados ok \(1\)/i)).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/histórico de pendientes en arca/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ocultar histórico de pendientes arca/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /ocultar histórico de pendientes arca/i }));

    expect(await screen.findByText(/conciliados ok \(1\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/histórico de pendientes en arca/i)).not.toBeInTheDocument();
  });
});

/**
 * Regression test for the view state machine: 'dashboard' | 'circuit' | 'report' | 'pendientes-historico'.
 * Ensures each view renders correctly and the navigation between views works.
 */
describe('view state machine: dashboard | circuit | report | pendientes-historico', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders dashboard view after selecting a tenant', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();

    // Should be in dashboard view by default (Section B lists the cerrado período).
    expect(screen.getByRole('heading', { name: /Conciliador Inteligente de Comprobantes/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Histórico/i })).toBeInTheDocument();
  });

  it('navigates to circuit view via "Ver reporte" (RF-24/RF-26 round-trip)', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();
    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));

    // Circuit view should render
    const circuitView = screen.getByText(/Período 2026-08/);
    expect(circuitView).toBeInTheDocument();
  });

  it('"Cambiar período" returns to Dashboard WITHOUT clearing tenantId (regression: used to share a handler with "Cambiar tenant")', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();
    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));
    expect(screen.getByText(/Período 2026-08/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar período' }));

    // Back at Dashboard for the SAME tenant — not bounced to tenant-entry.
    expect(await screen.findByRole('heading', { name: /Histórico/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
  });

  it('navigates to report view via the nav tab', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();
    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));

    // The nav button is exactly "Reporte" — the Dashboard's own SectionB
    // "Ver reporte" button also matches /Reporte/i, so use an exact match.
    await userEvent.click(screen.getByRole('button', { name: 'Reporte' }));

    // Report view should render
    expect(await screen.findByText(/conciliados ok \(1\)/i)).toBeInTheDocument();
  });

  it('navigates to pendientes-historico view', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();
    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));

    // Navigate to pendientes-historico view. Exact match: the circuit
    // header's own "Ver histórico de pendientes ARCA" toggle (cerrado
    // período) also matches /Histórico/i loosely.
    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }));

    // Histórico view should render
    expect(await screen.findByText(/histórico de pendientes en arca/i)).toBeInTheDocument();
  });

  it('cycles through all views and returns to dashboard', async () => {
    global.fetch = mockFetchByUrl();
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();
    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));

    // Start at circuit (just navigated there), cycle through all views.
    // Exact matches: the circuit header's own toggles ("Ver reporte del
    // período" / "Ver histórico de pendientes ARCA") also loosely match.
    await userEvent.click(screen.getByRole('button', { name: 'Circuito' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reporte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));

    // Should be back at dashboard
    expect(screen.getByRole('heading', { name: /Conciliador Inteligente de Comprobantes/i })).toBeInTheDocument();
  });

  it('navigating back to Dashboard remounts it with a fresh listPeriodos fetch (RF-24)', async () => {
    const fetchMock = mockFetchByUrl();
    global.fetch = fetchMock;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();

    const periodosCallCount = () =>
      (fetchMock as jest.Mock).mock.calls.filter(([input]: [unknown]) =>
        String(input).includes('/api/periodos?tenant_id='),
      ).length;

    // 1 call so far: the Dashboard's own mount fetch (PeriodoSelector no
    // longer does its own round-trip — see PeriodoSelector.tsx's comment on
    // why that validation was removed again).
    expect(periodosCallCount()).toBe(1);

    await userEvent.click(await screen.findByRole('button', { name: /Ver reporte/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));

    // Dashboard unmounted (view left 'dashboard') then remounted -> its
    // useEffect re-ran listPeriodos, a SECOND independent call.
    await waitFor(() => expect(periodosCallCount()).toBe(2));
  });
});

/**
 * Role-based access control tests for the app.
 * Ensures cliente sees read-only UI, admin/colaborador see full UI.
 */
describe('role-based access control', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The nav buttons (Dashboard/Circuito/Reporte/Histórico) only appear after
  // a período is selected, so roles must go through the same flow the app
  // actually requires: pick a tenant -> Ingresar -> Continuar al dashboard
  // -> Abrir the (single, abierto) período from the Dashboard.
  async function searchAndSelectPeriodo() {
    await enterTenant();
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));
  }

  it('cliente is read-only: no upload form in circuito view', async () => {
    global.fetch = mockFetchByUrl([abiertoPeriodo]);
    setSession('tok-1', { id: 'u1', email: 'cliente@test.com', role: 'cliente', display_name: 'Cliente', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await searchAndSelectPeriodo();

    // Cliente still gets the navigation, but the upload form is hidden.
    // The UploadForm renders a file input labelled "Archivo Contabilidad",
    // so assert on its absence (the read-only message also contains the
    // phrase "subir comprobantes", which would match a text query spuriously).
    await userEvent.click(screen.getByRole('button', { name: /Circuito/i }));
    expect(screen.getByText(/Tu usuario es de solo lectura/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/archivo contabilidad/i)).not.toBeInTheDocument();
  });

  it('admin sees full navigation after selecting a período', async () => {
    global.fetch = mockFetchByUrl([abiertoPeriodo]);
    setSession('tok-1', { id: 'u1', email: 'admin@test.com', role: 'admin', display_name: 'Admin', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await searchAndSelectPeriodo();

    // Admin should see all navigation buttons. "Abrir" lands directly in
    // circuit view (RF-24) — use an exact match for the nav tab, since the
    // circuit header's own "Ver reporte del período" toggle also matches
    // /Reporte/i loosely.
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Circuito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reporte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Histórico' })).toBeInTheDocument();
  });

  it('colaborador sees full navigation after selecting a período', async () => {
    global.fetch = mockFetchByUrl([abiertoPeriodo]);
    setSession('tok-1', { id: 'u1', email: 'colab@test.com', role: 'colaborador', display_name: 'Colaborador', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await searchAndSelectPeriodo();

    // Colaborador should see navigation
    expect(screen.getByRole('button', { name: 'Circuito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reporte' })).toBeInTheDocument();
  });
});

/**
 * Regression: a tenant with zero períodos never has a `periodo` selected,
 * so the nav tabs (periodo && (...)) never render — before this fix, that
 * left no way back to PeriodoSelector short of a full logout.
 */
describe('zero-período tenant is not a dead end', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets the user change tenant from the Dashboard even with zero períodos', async () => {
    global.fetch = mockFetchByUrl([]);
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();

    expect(await screen.findByText(/todavía no tiene períodos/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cambiar tenant/i }));

    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();
  });
});

/**
 * 2026-10-11: review fix for a dead-end — if Dashboard's shared
 * `listPeriodos` fetch fails (or the tenant has zero períodos), the user
 * was stuck on the dashboard with no way back to tenant entry, since
 * `PeriodoSelector` only remounts once `tenantId` is cleared. Dashboard's
 * "Cambiar tenant" escape hatch (shown once loading settles and the fetch
 * either failed or came back empty) gives that way back, wired through
 * page.tsx's `handleChangeTenant`.
 */
describe('2026-10-11: Dashboard has a way back to tenant entry on fetch error', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('shows "Cambiar tenant" on a listPeriodos failure and returns to PeriodoSelector on click', async () => {
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });
    global.fetch = jest.fn((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(MY_TENANTS_URL)) return myTenantsResponse();
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'db down' }) });
    }) as unknown as typeof fetch;

    render(<Home />);
    await enterTenant();

    expect(await screen.findAllByText(/db down/i)).not.toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /cambiar tenant/i }));

    expect(await screen.findByLabelText(/tenant/i)).toBeInTheDocument();
    expect(screen.queryByText(/db down/i)).not.toBeInTheDocument();
  });
});

/**
 * Regression: onCreatePeriodo/onReopenPeriodo/onDeletePeriodo failures used
 * to call native alert() — invisible to screen readers and untestable the
 * way every other error path in this app is (an accessible role="alert"
 * banner). Confirms the accessible banner appears instead, and that
 * alert() is never called.
 */
describe('Dashboard mutation failures surface an accessible banner, not alert()', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('crear período fallido muestra un banner role="alert" y no llama a alert()', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    global.fetch = jest.fn((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (url.includes(MY_TENANTS_URL)) {
        return myTenantsResponse();
      }
      if (url.includes('/api/periodos?tenant_id=')) {
        return Promise.resolve({ ok: true, json: async () => ({ periodos: [] }) });
      }
      if (url.includes(`/api/tenants/${TENANT_ID}/pendientes-historico`)) {
        return Promise.resolve({ ok: true, json: async () => pendientesHistoricoBody });
      }
      if (url.endsWith('/api/periodos') && method === 'POST') {
        return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'ALREADY_ABIERTO' }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${method}`));
    }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();

    await userEvent.click(await screen.findByRole('button', { name: /Crear nuevo período/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/error al crear per[ií]odo/i);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

/**
 * Fix 1 (review 2026-10-11): "Crear nuevo período" used to call
 * `createPeriodo` with `new Date().toISOString().slice(0, 7)` — the UTC
 * month. In Argentina (UTC-3) this rolled over a day early: clicking
 * between 21:00-23:59 local on the last day of the month created a
 * período for NEXT month instead of the current one. Unit coverage for
 * the extracted `currentLocalYearMonth()` helper lives in lib/date.test.ts
 * — this test confirms the real click flow actually sends that local
 * value through to the API, not a UTC-derived one.
 */
describe('Fix 1 (2026-10-11): "Crear nuevo período" sends the local month, not UTC', () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    jest.useRealTimers();
    process.env.TZ = ORIGINAL_TZ;
    jest.restoreAllMocks();
    clearSession();
  });

  it('creates the período for the local month even when UTC has already rolled over to the next month', async () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires'; // UTC-3, no DST
    // 2026-08-31 23:30 local (ART) == 2026-09-01 02:30 UTC — a UTC-based
    // read would wrongly produce '2026-09'.
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }).setSystemTime(new Date('2026-09-01T02:30:00.000Z'));
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    let createdBody: { tenant_id: string; mes: string } | null = null;
    global.fetch = jest.fn((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(MY_TENANTS_URL)) {
        return myTenantsResponse();
      }
      if (url.includes('/api/periodos?tenant_id=')) {
        return Promise.resolve({ ok: true, json: async () => ({ periodos: [] }) });
      }
      if (url.endsWith('/api/periodos') && init && (init as RequestInit).method === 'POST') {
        createdBody = JSON.parse((init as RequestInit).body as string);
        return Promise.resolve({ ok: true, json: async () => ({ ...abiertoPeriodo, mes: createdBody!.mes }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    const select = await screen.findByLabelText(/tenant/i);
    await user.selectOptions(select, TENANT_ID);
    await user.click(screen.getByRole('button', { name: /ingresar/i }));
    await user.click(await screen.findByRole('button', { name: /continuar al dashboard/i }));
    await user.click(await screen.findByRole('button', { name: /Crear nuevo período/i }));

    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody!.mes).toBe('2026-08');
  });
});

/**
 * Fix 2 (review 2026-10-11): `handleOpenPeriodo` never cleared
 * `dashboardError`, unlike `handleTenantSelected`/`handleChangeTenant` — so a
 * stale error banner from a failed mutation (e.g. a failed "Reabrir")
 * stayed on screen after the user opened an unrelated, healthy período.
 */
describe('Fix 2 (2026-10-11): opening a período clears a stale dashboardError banner', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearSession();
  });

  it('clears the dashboardError banner left by a failed "Reabrir" once a healthy período is opened', async () => {
    global.fetch = jest.fn((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(MY_TENANTS_URL)) {
        return myTenantsResponse();
      }
      if (url.includes('/api/periodos?tenant_id=')) {
        return Promise.resolve({ ok: true, json: async () => ({ periodos: [abiertoPeriodo, cerradoPeriodo] }) });
      }
      if (url.includes('/reabrir')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'reabrir failed' }) });
      }
      if (url.includes(`/api/tenants/${TENANT_ID}/pendientes-historico`)) {
        return Promise.resolve({ ok: true, json: async () => pendientesHistoricoBody });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana', estudio_id: 'test-estudio-id' });

    render(<Home />);
    await enterTenant();

    await userEvent.click(await screen.findByRole('button', { name: /^Reabrir$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Error al reabrir período: reabrir failed/i);

    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
