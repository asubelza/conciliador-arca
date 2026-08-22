/**
 * lib/api.ts — T13: thin fetch wrapper around the NestJS API
 * (packages/api/src/reconciliations/reconciliations.controller.ts).
 *
 * Kept dependency-free (no framework imports) so it's testable in isolation
 * with a mocked `fetch`, same rationale as upload-validation.ts on the API
 * side.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export const CONTABILIDAD_SOURCE_SYSTEMS = [
  'tango',
  'bejerman',
  'xubio',
  'contabilium',
  'libro_iva_compras',
] as const;
export type ContabilidadSourceSystem = (typeof CONTABILIDAD_SOURCE_SYSTEMS)[number];

export interface UploadResponse {
  job_id: string;
  status_url: string;
}

export type ReconciliationStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface StatusResponse {
  status: ReconciliationStatus;
  counts?: { arca_rows: number; contabilidad_rows: number };
  detail?: string;
}

export interface DiffReportRow {
  classification: string;
  composite_key: string;
  arca_importe: number | null;
  contabilidad_importe: number | null;
  delta: number | null;
  iva_amount: number | null;
  cae: string | null;
  fecha_emision: string | null;
}

export type UserMarkClassification = 'revisado' | 'explicado';

export interface MarkResponse {
  id: string;
  tenant_id: string;
  user_id: string | null;
  composite_key: string;
  classification: string;
  note: string | null;
  created_at: string;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function uploadReconciliation(params: {
  tenantId: string;
  contabilidadSourceSystem: ContabilidadSourceSystem;
  arcaFile: File;
  contabilidadFile: File;
}): Promise<UploadResponse> {
  const form = new FormData();
  form.append('tenant_id', params.tenantId);
  form.append('contabilidad_source_system', params.contabilidadSourceSystem);
  form.append('arca_file', params.arcaFile);
  form.append('contabilidad_file', params.contabilidadFile);

  const res = await fetch(`${API_BASE_URL}/api/reconciliations`, { method: 'POST', body: form });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Upload failed (${res.status})`));
  }
  return res.json();
}

export async function getStatus(jobId: string): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/reconciliations/${jobId}/status`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Status check failed (${res.status})`));
  }
  return res.json();
}

export async function getReportRows(jobId: string): Promise<DiffReportRow[]> {
  const res = await fetch(`${API_BASE_URL}/api/reconciliations/${jobId}/report?format=json`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Report fetch failed (${res.status})`));
  }
  const data = await res.json();
  return data.rows;
}

/** Plain download link — the browser follows it directly, no fetch/blob juggling needed. */
export function reportDownloadUrl(jobId: string, format: 'csv' | 'xlsx'): string {
  return `${API_BASE_URL}/api/reconciliations/${jobId}/report?format=${format}`;
}

export async function createMark(
  jobId: string,
  mark: { composite_key: string; classification: UserMarkClassification; note?: string },
): Promise<MarkResponse> {
  const res = await fetch(`${API_BASE_URL}/api/reconciliations/${jobId}/marks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mark),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Mark failed (${res.status})`));
  }
  return res.json();
}
