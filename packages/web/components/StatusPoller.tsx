'use client';

import { useEffect, useState } from 'react';
import { getStatus, type StatusResponse } from '@/lib/api';

export interface StatusPollerProps {
  jobId: string;
  onCompleted: () => void;
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
          onCompleted();
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
      <p role="alert" className="text-red-600 text-sm">
        {error}
      </p>
    );
  }

  if (status.status === 'error') {
    return (
      <p role="alert" className="text-red-600 text-sm">
        {status.detail ?? 'La reconciliación falló'}
      </p>
    );
  }

  if (status.status === 'completed') {
    return (
      <p className="text-green-700 text-sm">
        Reconciliación completa
        {status.counts ? ` (ARCA: ${status.counts.arca_rows}, Contabilidad: ${status.counts.contabilidad_rows})` : ''}.
      </p>
    );
  }

  return (
    <p aria-live="polite" className="text-sm text-gray-600">
      {status.status === 'processing' ? 'Procesando…' : 'En cola…'}
    </p>
  );
}
