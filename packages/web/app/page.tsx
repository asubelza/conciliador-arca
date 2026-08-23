'use client';

import { useState } from 'react';
import { PeriodoSelector } from '@/components/PeriodoSelector';
import { UploadForm } from '@/components/UploadForm';
import { StatusPoller } from '@/components/StatusPoller';
import { UploadSummary } from '@/components/UploadSummary';
import { ReportViewer } from '@/components/ReportViewer';
import { PeriodoReportViewer } from '@/components/PeriodoReportViewer';
import { PendientesHistoricoViewer } from '@/components/PendientesHistoricoViewer';
import { LoginForm } from '@/components/LoginForm';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BuildingIcon, LogoutIcon } from '@/components/icons';
import { clearSession, useAuth } from '@/lib/session';
import type { Periodo, SessionUser, StatusResponse } from '@/lib/api';

const ROLE_BADGE_CLASSES: Record<SessionUser['role'], string> = {
  admin: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  colaborador: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  cliente: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

type UploadStep = 'upload' | 'processing' | 'completed';

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
 */
export default function Home() {
  const { user } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobCounts, setJobCounts] = useState<StatusResponse['counts']>(undefined);
  const [showJobReport, setShowJobReport] = useState(false);
  const [showPeriodoReport, setShowPeriodoReport] = useState(false);
  const [showPendientesHistorico, setShowPendientesHistorico] = useState(false);

  // T39 (Fase 3, autenticacion-roles): no session (never logged in, logged
  // out, or a 401 auto-cleared it — see lib/api.ts's handleUnauthorized) ->
  // show the login screen instead of the app. Everything below this line
  // only ever renders for an authenticated user.
  if (!user) {
    return <LoginForm />;
  }

  function handlePeriodoSelected(selectedTenantId: string, selectedPeriodo: Periodo) {
    setTenantId(selectedTenantId);
    setPeriodo(selectedPeriodo);
    setUploadStep('upload');
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setShowPeriodoReport(selectedPeriodo.estado === 'cerrado');
    setShowPendientesHistorico(false);
  }

  function handleChangePeriodo() {
    setTenantId(null);
    setPeriodo(null);
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setShowPeriodoReport(false);
    setShowPendientesHistorico(false);
  }

  function handleUploadAnother() {
    setJobId(null);
    setJobCounts(undefined);
    setShowJobReport(false);
    setUploadStep('upload');
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
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

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
        {!periodo && <PeriodoSelector onSelected={handlePeriodoSelected} />}

        {periodo && tenantId && (
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
                {/* 2026-08-23 (client request, feature 3 de 3): "luego de
                    finalizar agregar 1 nueva pantalla..." — only reachable
                    once este período fue finalizado (cerrado), i.e. after
                    "Cerrar Conciliación del Mes". */}
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
                {uploadStep === 'upload' && user.role === 'cliente' && (
                  <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    Tu usuario es de solo lectura — no podés subir comprobantes para este período.
                  </p>
                )}

                {uploadStep === 'upload' && user.role !== 'cliente' && (
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

            {(showPeriodoReport || periodo.estado === 'cerrado') && (
              <PeriodoReportViewer periodoId={periodo.id} onClosed={(closed) => setPeriodo(closed)} />
            )}

            {periodo.estado === 'cerrado' && showPendientesHistorico && (
              <PendientesHistoricoViewer tenantId={tenantId} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
