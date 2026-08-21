'use client';

import { useState } from 'react';
import { UploadForm } from '@/components/UploadForm';
import { StatusPoller } from '@/components/StatusPoller';
import { ReportViewer } from '@/components/ReportViewer';

type Step = 'upload' | 'processing' | 'report';

/**
 * T13: single-page flow — upload form -> status poll -> diff report viewer.
 * `step` only ever moves forward (upload -> processing -> report); a new
 * upload is a fresh page load, matching the MVP's one-job-at-a-time scope.
 */
export default function Home() {
  const [step, setStep] = useState<Step>('upload');
  const [jobId, setJobId] = useState<string | null>(null);

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Conciliador Inteligente de Comprobantes</h1>
        <p className="text-sm text-gray-600">Subí el archivo de ARCA y el de tu sistema contable para conciliar.</p>
      </div>

      {step === 'upload' && (
        <UploadForm
          onUploaded={(id) => {
            setJobId(id);
            setStep('processing');
          }}
        />
      )}

      {step === 'processing' && jobId && (
        <StatusPoller jobId={jobId} onCompleted={() => setStep('report')} />
      )}

      {step === 'report' && jobId && <ReportViewer jobId={jobId} />}
    </main>
  );
}
