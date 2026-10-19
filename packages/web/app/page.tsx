'use client';

import { useEffect, useState } from 'react';
import { PeriodoSelector } from '@/components/PeriodoSelector';
import { UploadForm } from '@/components/UploadForm';
import { StatusPoller } from '@/components/StatusPoller';
import { UploadSummary } from '@/components/UploadSummary';
import { ReportViewer } from '@/components/ReportViewer';
import { PeriodoReportViewer } from '@/components/PeriodoReportViewer';
import { PendientesHistoricoViewer } from '@/components/PendientesHistoricoViewer';
import { DashboardShell as Dashboard } from '@/components/Dashboard';
import { LoginForm } from '@/components/LoginForm';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BackofficeView } from '@/components/BackofficeView';
import { PlatformView } from '@/components/PlatformView';
import { SetPasswordPage } from '@/components/SetPasswordPage';
import { BuildingIcon, LogoutIcon } from '@/components/icons';
import { clearSession, useAuth } from '@/lib/session';
import {
  reabrirPeriodo,
  eliminarPeriodo,
  createPeriodo,
  type Periodo,
  type SessionUser,
  type StatusResponse,
} from '@/lib/api';

const ROLE_BADGE_CLASSES: Record<SessionUser['role'], string> = {
  admin: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  colaborador: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  cliente: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

type UploadStep = 'upload' | 'processing' | 'completed';
type View = 'dashboard' | 'circuit' | 'report' | 'pendientes-historico';

/**
 * T13 + T30 (conciliacion-periodica): período selection now runs before any
 * upload — `POST /api/reconciliations` has required `periodo_id` since PR-4
 * (T19), so this screen has to pick/create an open período first. Once a
 * período is selected: an `abierto` one shows the (possibly repeated)
 * upload -> processing -> completed loop plus a toggle to the período's
 * 3-section report (T31, with the "Cerrar Conciliación del Mes" button,
 * T30/RF-20); a `cerrado` one (selected straight from PeriodoSelector's
 * list) goes directly to its frozen report — a closed período can't
 * receive uploads (RF-13), so there's nothing else to show.
 *
 * `uploadStep` has an explicit 'completed' state (not just 'processing' ->
 * 'upload') — StatusPoller's `onCompleted` fires and its parent re-renders
 * in the same tick, so if that callback swapped straight back to the
 * upload form, "Reconciliación completa" would never actually be visible
 * to the user (caught by this phase's own Playwright smoke test:
 * onCompleted flipping directly to 'upload' produced a form the user could
 * resubmit into without ever seeing confirmation the previous upload
 * worked, and the per-job ReportViewer — fetched too early, while the job
 * was still processing — spun on a permanent 409).
 *
 * T30 (conciliacion-periodica): after período selection, the system enters
 * a view state machine: 'dashboard' | 'circuit' | 'report' | 'pendientes-historico'.
 * The UUID paste step MUST remain exactly as today.
 *
 * AD-6 (dashboard-principal): `PeriodoSelector` was slimmed to a pure
 * tenant-entry step (it now yields only `tenantId`) — `Dashboard` (Section
 * A/B) now owns período listing/selection via its own `listPeriodos` call.
 */
export default function Home() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobCounts, setJobCounts] = useState<StatusResponse['counts']>(undefined);
  const [showJobReport, setShowJobReport] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [showPeriodoReport, setShowPeriodoReport] = useState(false);
  const [showPendientesHistorico, setShowPendientesHistorico] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  // Backoffice self-service (invitación por email): starts `null` (matching
  // what the server/static-prerendered HTML for `/` always renders) and is
  // only ever set from a `useEffect` below, never from this initializer —
  // reading `window.location.search` here instead would diverge from the
  // prerendered markup on the very first client render and trip a React
  // hydration-mismatch error (#418/#423/#425), since this page is
  // statically prerendered at build time with no token in scope.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [showBackoffice, setShowBackoffice] = useState(false);

  // Runs once after hydration completes — safe to read `window` here.
  useEffect(() => {
    setInviteToken(new URLSearchParams(window.location.search).get('invite_token'));
  }, []);

  // Backoffice self-service (approved plan, decision 5): a `?invite_token=`
  // link wins even over an existing session — e.g. an admin testing the
  // flow while already logged in as themselves should still land on
  // SetPasswordPage, not skip straight to the main app. Must run before the
  // `if (!user)` gate below, not after it.
  if (inviteToken) {
    return <SetPasswordPage token={inviteToken} onAccepted={() => setInviteToken(null)} />;
  }

  // T39 (Fase 3, autenticacion-roles): no session (never logged in, logged
  // out, or a 401 auto-cleared it — see lib/api.ts's handleUnauthorized) ->
  // show the login screen instead of the app. Everything below this line
  // only ever renders for an authenticated user.
  if (!user) {
    return <LoginForm />;
  }

  // Hoisted out of `user` itself (rather than inlining `user.role` at every
  // call site) because the `function renderX()` declarations below are
  // hoisted closures — TS can't carry the `if (!user)` narrowing above into
  // them, even though they only ever execute after this point.
  const userRole = user.role as 'admin' | 'colaborador' | 'cliente';

  // Multi-estudio pivot (PR8): platform-level staff (estudio_id === null)
  // has nothing to do with the tenant/período flow below — listMyTenants
  // always returns [] for them, and every :id-scoped route 403s them
  // (tenant-access.ts) — so PlatformView replaces that ENTIRE flow rather
  // than toggling alongside it the way BackofficeView does for an
  // estudio's own admin.
  const isPlatformStaff = user.estudio_id === null;

  // AD-6: PeriodoSelector now only yields a tenantId — período selection
  // moved into Dashboard's sections A/B (RF-24..RF-26).
  function handleTenantSelected(selectedTenantId: string) {
    setTenantId(selectedTenantId);
    setPeriodo(null);
    setUploadStep('upload');
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setShowPeriodoReport(false);
    setShowPendientesHistorico(false);
    setDashboardError(null);
    setView('dashboard');
  }

  // RF-24: "Abrir" on an open período (Dashboard Section A) round-trips
  // through the existing circuit verbatim.
  function handleOpenPeriodo(selectedPeriodo: Periodo) {
    setPeriodo(selectedPeriodo);
    setUploadStep('upload');
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setShowPeriodoReport(false);
    setShowPendientesHistorico(false);
    // Fix 2 (review 2026-10-11): clear a stale dashboardError left by a
    // failed mutation (e.g. a failed "Reabrir") so it doesn't survive
    // opening an unrelated, healthy período.
    setDashboardError(null);
    setView('circuit');
  }

  // Resets back to Dashboard for the SAME tenant — bound to the circuit
  // view's own "Cambiar período" button. Deliberately does NOT clear
  // tenantId (regression: it used to share a handler with "Cambiar tenant"
  // and bounced the user all the way back to PeriodoSelector).
  function handleChangePeriodo() {
    setPeriodo(null);
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setShowPeriodoReport(false);
    setShowPendientesHistorico(false);
    setDashboardError(null);
    setView('dashboard');
  }

  // AD-6: resets back to tenant entry (PeriodoSelector) — used both as the
  // explicit "Cambiar tenant" action from the circuit view and as the
  // escape hatch Dashboard offers when the períodos fetch fails or the
  // tenant has no períodos at all.
  function handleChangeTenant() {
    setTenantId(null);
    handleChangePeriodo();
  }

  function handleUploadAnother() {
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setUploadStep('upload');
  }

  // --- View state machine renderer ---

  // When in 'circuit' view, show the existing upload/report flow
  function renderCircuitView() {
    return periodo && tenantId && (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Período {periodo.mes} —{' '}
              <span
                className={
                  periodo.estado === 'abierto'
                    ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                    : 'font-semibold text-slate-500 dark:text-slate-400'
                }
              >
                {periodo.estado}
              </span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Tenant {tenantId}</p>
          </div>
          <div className="flex gap-4">
            {periodo.estado === 'abierto' && (
              <button
                type="button"
                onClick={() => setShowPeriodoReport((v) => !v)}
                className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
              >
                {showPeriodoReport ? 'Ocultar reporte del período' : 'Ver reporte del período'}
              </button>
            )}
            {periodo.estado === 'cerrado' && (
              <button
                type="button"
                onClick={() => setShowPendientesHistorico((v) => !v)}
                className="focus-ring rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
              >
                {showPendientesHistorico ? 'Ocultar histórico de pendientes ARCA' : 'Ver histórico de pendientes ARCA'}
              </button>
            )}
            <button
              type="button"
              onClick={handleChangePeriodo}
              className="focus-ring rounded text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cambiar período
            </button>
          </div>
        </div>

        {periodo.estado === 'abierto' && !showPeriodoReport && (
          <>
            {/* T39 (Fase 3): cliente is read-only (RF-14) — POST
                /api/reconciliations is admin/colaborador-only server-side
                (assertRole in reconciliations.controller.ts), so a
                cliente never sees a form that would only 403 anyway. */}
            {uploadStep === 'upload' && user?.role === 'cliente' && (
              <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Tu usuario es de solo lectura — no podés subir comprobantes para este período.
              </p>
            )}

            {uploadStep === 'upload' && user?.role !== 'cliente' && (
              <UploadForm
                tenantId={tenantId}
                periodoId={periodo.id}
                onUploaded={(id) => {
                  setJobId(id);
                  setUploadStep('processing');
                }}
              />
            )}

            {uploadStep === 'processing' && jobId && (
              <StatusPoller
                jobId={jobId}
                onCompleted={(counts) => {
                  setJobCounts(counts);
                  setUploadStep('completed');
                }}
              />
            )}

            {uploadStep === 'completed' && jobId && (
              <div className="flex flex-col gap-4">
                <UploadSummary
                  counts={jobCounts}
                  showingDetails={showJobReport}
                  onViewDetails={() => setShowJobReport(true)}
                  onUploadAnother={handleUploadAnother}
                />
                {showJobReport && <ReportViewer jobId={jobId} />}
              </div>
            )}
          </>
        )}

        {/* 2026-08-23 fix: when cerrado, showPendientesHistorico now
            SWAPS the period report for the histórico view instead of
            stacking below it — the period report can easily run to
            hundreds of rows (Conciliados OK alone), so the histórico
            section landing after it was effectively invisible without
            scrolling past the whole report first (reported by the
            client: clicked "Ver histórico de pendientes ARCA" and
            "no pasó nada visible" — it DID toggle, just far below the
            fold). `showPeriodoReport` defaults to false and
            handleOpenPeriodo resets it to false on every selection (it's
            never set true for a cerrado período) — it's only otherwise
            meaningful for the 'abierto' toggle above; an `||` here
            would always win regardless of showPendientesHistorico, so
            the visibility is branched by estado instead. */}
        {(periodo.estado === 'abierto' ? showPeriodoReport : !showPendientesHistorico) && (
          <PeriodoReportViewer periodoId={periodo.id} onClosed={(closed) => setPeriodo(closed)} />
        )}

        {periodo.estado === 'cerrado' && showPendientesHistorico && (
          <PendientesHistoricoViewer tenantId={tenantId} userRole={userRole} />
        )}
      </div>
    );
  }

  // When in 'report' view, show the period report
  function renderReportView() {
    return periodo && tenantId && (
      <PeriodoReportViewer periodoId={periodo.id} onClosed={(closed) => setPeriodo(closed)} />
    );
  }

  // When in 'pendientes-historico' view, show the historical viewer
  function renderPendientesHistoricoView() {
    return periodo && tenantId && (
      <PendientesHistoricoViewer tenantId={tenantId} userRole={userRole} />
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <BuildingIcon size={20} />
            </span>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold leading-tight text-slate-900 dark:text-slate-50">
                Conciliador Inteligente de Comprobantes
              </h1>
              <p className="text-xs leading-tight text-slate-500 dark:text-slate-400">ARCA vs. sistema contable</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="max-w-[10rem] truncate text-sm font-medium text-slate-700 dark:text-slate-200 sm:max-w-none">
                {user.display_name ?? user.email}
              </p>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASSES[user.role]}`}
              >
                {user.role}
              </span>
            </div>
            <ThemeToggle />
            {/* Platform staff has no "normal app" to toggle to/from — see
                isPlatformStaff's own comment above — so this toggle button
                is meaningless for them and hidden entirely rather than
                shown disabled. */}
            {!isPlatformStaff && userRole === 'admin' && (
              <button
                type="button"
                onClick={() => setShowBackoffice((v) => !v)}
                className="focus-ring rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {showBackoffice ? 'Volver' : 'Backoffice'}
              </button>
            )}
            <button
              type="button"
              onClick={() => clearSession()}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <LogoutIcon size={16} />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-screen-2xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Multi-estudio pivot (PR8): platform staff gets PlatformView and
            nothing else — see isPlatformStaff's own comment above — so this
            branch short-circuits before any of the estudio-scoped UI below
            even has a chance to render. */}
        {isPlatformStaff && <PlatformView userRole={userRole} />}

        {/* Wrapped once rather than prefixing `!isPlatformStaff &&` on each
            branch below — that repeated-at-every-call-site version is
            exactly the shape a future addition under `main` could forget
            to copy; wrapping makes "nothing here renders for platform
            staff" structurally true instead of relying on each branch
            remembering it. */}
        {!isPlatformStaff && (
          <>
            {/* Guarded here too (not just at the header button) — `showBackoffice`
                is local state that survives a logout/login in the same tab
                (clearSession() doesn't unmount Home or reset it), so without this
                check a non-admin who logs in right after an admin toggled it on
                would see the admin-only BackofficeView. */}
            {showBackoffice && userRole === 'admin' && <BackofficeView />}

            {!(showBackoffice && userRole === 'admin') && !tenantId && (
              <PeriodoSelector onSelected={handleTenantSelected} />
            )}

            {!(showBackoffice && userRole === 'admin') && tenantId && (
                <div className="flex flex-col gap-6">
              {/* Nav tabs only make sense once a período round-trips into the
                  existing circuit/report — Dashboard is the entry point.
                  Fixed position at the top regardless of `view` — it used to
                  sit right after the Dashboard block, which only renders for
                  view === 'dashboard', so the tabs visibly jumped to the
                  bottom of the (now much taller) dashboard content on that
                  view and stayed at the top on every other view. */}
              {periodo && (
                <div className="flex w-fit gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-card dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setView('dashboard')}
                    className={`focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'dashboard' ? 'bg-indigo-600 text-white shadow-card' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                  >
                    Dashboard
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('circuit')}
                    className={`focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'circuit' ? 'bg-indigo-600 text-white shadow-card' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                  >
                    Circuito
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('report')}
                    className={`focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'report' ? 'bg-indigo-600 text-white shadow-card' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                  >
                    Reporte
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('pendientes-historico')}
                    className={`focus-ring rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'pendientes-historico' ? 'bg-indigo-600 text-white shadow-card' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`}
                  >
                    Histórico
                  </button>
                </div>
              )}
  
              {/* Section A: Período en curso (Dashboard) */}
              {view === 'dashboard' && dashboardError && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                  {dashboardError}
                </p>
              )}
              {view === 'dashboard' && (
                <Dashboard
                  tenantId={tenantId}
                  userRole={userRole}
                  onOpenPeriodo={handleOpenPeriodo}
                  onChangeTenant={handleChangeTenant}
                  onCreatePeriodo={async (mes) => {
                    try {
                      setDashboardError(null);
                      const newPeriodo = await createPeriodo(tenantId, mes);
                      handleOpenPeriodo(newPeriodo);
                    } catch (err) {
                      console.error('Error creating período:', err);
                      setDashboardError('Error al crear período: ' + (err instanceof Error ? err.message : String(err)));
                      throw err;
                    }
                  }}
                  onReopenPeriodo={async (p) => {
                    // La confirmación ya la hace el ConfirmDialog interno del
                    // Dashboard (SectionB); acá solo ejecutamos la operación.
                    try {
                      setDashboardError(null);
                      const { periodo: reopened } = await reabrirPeriodo(p.id);
                      if (periodo?.id === p.id) setPeriodo(reopened);
                    } catch (err) {
                      console.error('Error reopening período:', err);
                      setDashboardError('Error al reabrir período: ' + (err instanceof Error ? err.message : String(err)));
                      throw err;
                    }
                  }}
                  onDeletePeriodo={async (p) => {
                    // La confirmación ya la hace el ConfirmDialog interno del
                    // Dashboard (SectionA).
                    try {
                      setDashboardError(null);
                      await eliminarPeriodo(p.id);
                      if (periodo?.id === p.id) setPeriodo(null);
                    } catch (err) {
                      console.error('Error deleting período:', err);
                      setDashboardError('Error al eliminar período: ' + (err instanceof Error ? err.message : String(err)));
                      throw err;
                    }
                  }}
                  // RF-26: "Ver reporte" on a closed período (Section B) also
                  // round-trips through the existing circuit view verbatim —
                  // for a cerrado período that view renders PeriodoReportViewer
                  // by default (see renderCircuitView's estado ternary below).
                  onViewReport={handleOpenPeriodo}
                />
              )}
  
              {/* Render the selected view */}
              {view === 'circuit' && renderCircuitView()}
              {view === 'report' && renderReportView()}
              {view === 'pendientes-historico' && renderPendientesHistoricoView()}
  
              {/* Dashboard is the default - rendered above */}
            </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
