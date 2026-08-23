import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from './page';
import { clearSession, setSession } from '@/lib/session';

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const PERIODO_ID = '44444444-4444-4444-4444-444444444444';

const cerradoPeriodo = {
  id: PERIODO_ID,
  tenant_id: TENANT_ID,
  mes: '2026-08-01',
  estado: 'cerrado',
  tolerancia_ars: null,
  cerrado_at: '2026-08-23T00:00:00Z',
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
};

function mockFetchByUrl() {
  return jest.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/periodos?tenant_id=')) {
      return Promise.resolve({ ok: true, json: async () => ({ periodos: [cerradoPeriodo] }) });
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
    clearSession();
  });

  it('shows the login form when there is no session', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /conciliador inteligente de comprobantes/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tenant id/i)).not.toBeInTheDocument();
  });

  it('shows the main app + user info + logout once a session exists', () => {
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana' });
    render(<Home />);

    expect(screen.getByLabelText(/tenant id/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });
});

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
    setSession('tok-1', { id: 'u1', email: 'ana@estudio.com', role: 'admin', display_name: 'Ana' });
    global.fetch = mockFetchByUrl();

    render(<Home />);

    await userEvent.type(screen.getByLabelText(/tenant id/i), TENANT_ID);
    await userEvent.click(screen.getByRole('button', { name: /buscar períodos/i }));
    await userEvent.click(await screen.findByRole('button', { name: /2026-08-01/i }));

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
