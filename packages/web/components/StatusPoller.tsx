'use client';

import { useEffect, useState } from 'react';
import { getStatus, type StatusResponse } from '@/lib/api';
import { CheckIcon, SpinnerIcon, WarningIcon } from './icons';

export interface StatusPollerProps {
  jobId: string;
  /**
   * T38 (pedido del cliente, 2026-08-23): forwards the job's classification
   * counts (already computed by the worker — see job-status.ts) so the
   * parent can feed them straight into UploadSummary without a second
   * fetch. `undefined` if the completed response somehow carried none.
   */
  onCompleted: (counts?: StatusResponse['counts']) => void;
  pollIntervalMs?: number;
}

/**
 * T13 (RF-04's client side): polls GET /api/reconciliations/:jobId/status
 * until it reaches a terminal state, showing a progress indicator in
 * between. `onCompleted` is read from the initial render's closure only
 * (deliberately excluded from the effect's dependency array) — the parent
 * passes a fresh callback each render, and re-subscribing the poll loop
 * whenever that happens (rather than only when `jobId` changes) would
 * restart the whole poll/backoff cycle for no reason.
 */
export function StatusPoller({ jobId, onCompleted, pollIntervalMs = 1500 }: StatusPollerProps) {
  const [status, setStatus] = useState<StatusResponse>({ status: 'pending' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await getStatus(jobId);
        if (cancelled) return;
        setStatus(res);
        if (res.status === 'completed') {
          onCompleted(res.counts);
          return;
        }
        if (res.status === 'error') {
          return;
        }
        timer = setTimeout(poll, pollIntervalMs);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Status check failed');
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, pollIntervalMs]);

  if (error) {
    return (
      <p
        role="alert"
        className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-card dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
      >
        <WarningIcon size={16} className="shrink-0" />
        {error}
      </p>
    );
  }

  if (status.status === 'error') {
    return (
      <p
        role="alert"
        className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-card dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
      >
        <WarningIcon size={16} className="shrink-0" />
        {status.detail ?? 'La reconciliación falló'}
      </p>
    );
  }

  if (status.status === 'completed') {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700 shadow-card dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
        <CheckIcon size={16} className="shrink-0" />
        Reconciliación completa
        {status.counts ? ` (ARCA: ${status.counts.arca_rows}, Contabilidad: ${status.counts.contabilidad_rows})` : ''}.
      </p>
    );
  }

  return (
    <p
      aria-live="polite"
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-card dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
    >
      <SpinnerIcon size={16} className="shrink-0 text-indigo-500" />
      {status.status === 'processing' ? 'Procesando…' : 'En cola…'}
    </p>
  );
}
