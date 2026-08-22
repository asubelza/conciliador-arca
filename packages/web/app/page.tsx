'use client';

import { useState } from 'react';
import { PeriodoSelector } from '@/components/PeriodoSelector';
import { UploadForm } from '@/components/UploadForm';
import { StatusPoller } from '@/components/StatusPoller';
import { ReportViewer } from '@/components/ReportViewer';
import { PeriodoReportViewer } from '@/components/PeriodoReportViewer';
import { LoginForm } from '@/components/LoginForm';
import { clearSession, useAuth } from '@/lib/session';
import type { Periodo } from '@/lib/api';

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
  const [showPeriodoReport, setShowPeriodoReport] = useState(false);

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
    setShowPeriodoReport(selectedPeriodo.estado === 'cerrado');
  }

  function handleChangePeriodo() {
    setTenantId(null);
    setPeriodo(null);
    setJobId(null);
    setShowPeriodoReport(false);
  }

  function handleUploadAnother() {
    setJobId(null);
    setUploadStep('upload');
  }

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Conciliador Inteligente de Comprobantes</h1>
          <p className="text-sm text-gray-600">Subí el archivo de ARCA y el de tu sistema contable para conciliar.</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-700">{user.display_name ?? user.email}</p>
          <p className="text-xs text-gray-500">{user.role}</p>
          <button type="button" onClick={() => clearSession()} className="text-xs underline text-gray-600">
            Cerrar sesión
          </button>
        </div>
      </div>

      {!periodo && <PeriodoSelector onSelected={handlePeriodoSelected} />}

      {periodo && tenantId && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <p className="text-sm font-medium">
                Período {periodo.mes} — <span className={periodo.estado === 'abierto' ? 'text-green-700' : 'text-gray-500'}>{periodo.estado}</span>
              </p>
              <p className="text-xs text-gray-600">Tenant {tenantId}</p>
            </div>
            <div className="flex gap-3">
              {periodo.estado === 'abierto' && (
                <button type="button" onClick={() => setShowPeriodoReport((v) => !v)} className="text-sm underline text-blue-600">
                  {showPeriodoReport ? 'Ocultar reporte del período' : 'Ver reporte del período'}
                </button>
              )}
              <button type="button" onClick={handleChangePeriodo} className="text-sm underline text-gray-600">
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
                <p className="text-sm text-gray-600">
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
                <StatusPoller jobId={jobId} onCompleted={() => setUploadStep('completed')} />
              )}

              {uploadStep === 'completed' && jobId && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <p className="text-green-700 text-sm">Carga procesada.</p>
                    <button type="button" onClick={handleUploadAnother} className="bg-blue-600 text-white rounded px-4 py-2 text-sm">
                      Subir otro archivo
                    </button>
                  </div>
                  <ReportViewer jobId={jobId} />
                </div>
              )}
            </>
          )}

          {(showPeriodoReport || periodo.estado === 'cerrado') && (
            <PeriodoReportViewer periodoId={periodo.id} onClosed={(closed) => setPeriodo(closed)} />
          )}
        </div>
      )}
    </main>
  );
}
