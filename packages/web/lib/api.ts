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
  periodoId: string;
  contabilidadSourceSystem: ContabilidadSourceSystem;
  arcaFile: File;
  contabilidadFile: File;
}): Promise<UploadResponse> {
  const form = new FormData();
  form.append('tenant_id', params.tenantId);
  form.append('periodo_id', params.periodoId);
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

// --- conciliacion-periodica (T30-T32): períodos, cierre, reporte de 3
// secciones, y tolerancia por tenant. See packages/api/src/periodos/* and
// packages/api/src/tenants/* for the endpoints these wrap. ---

export interface Periodo {
  id: string;
  tenant_id: string;
  mes: string;
  estado: 'abierto' | 'cerrado';
  tolerancia_ars: string | null;
  cerrado_at: string | null;
  cerrado_por: string | null;
  created_at?: string;
}

export async function listPeriodos(tenantId: string): Promise<Periodo[]> {
  const res = await fetch(`${API_BASE_URL}/api/periodos?tenant_id=${encodeURIComponent(tenantId)}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Períodos fetch failed (${res.status})`));
  }
  const data = await res.json();
  return data.periodos;
}

/** `mes` accepts 'YYYY-MM' or 'YYYY-MM-DD' — the API normalizes to the 1st of the month. */
export async function createPeriodo(tenantId: string, mes: string): Promise<Periodo> {
  const res = await fetch(`${API_BASE_URL}/api/periodos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, mes }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Período creation failed (${res.status})`));
  }
  return res.json();
}

export interface PeriodoCierreResponse {
  periodo: Periodo;
  counts: Record<string, number>;
}

/** RF-20: "Cerrar Conciliación del Mes" — one-way, rejected with 409 if already cerrado. */
export async function cerrarPeriodo(periodoId: string, cerradoPor?: string): Promise<PeriodoCierreResponse> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/cerrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cerradoPor ? { cerrado_por: cerradoPor } : {}),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Cierre failed (${res.status})`));
  }
  return res.json();
}

export interface PeriodoVoucherRow {
  id: string;
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  importe_total: number | null;
  iva: number | null;
  fecha: string | null;
  file_source: 'arca' | 'contabilidad';
  estado: 'pendiente' | 'conciliado';
  periodo_alta_id: string;
}

export interface PeriodoReportRow {
  classification: 'conciliado_ok' | 'con_divergencia' | 'posible_duplicado_en_sistema' | 'no_existe_en_arca' | 'pendiente_en_arca';
  composite_key: string;
  sistema: PeriodoVoucherRow | null;
  arca: PeriodoVoucherRow | null;
  divergencia_ars: number | null;
  antiguedad_meses: number | null;
}

export interface PeriodoReportSections {
  conciliados_ok: PeriodoReportRow[];
  discrepancias_y_alertas: PeriodoReportRow[];
  pendientes_en_arca: PeriodoReportRow[];
}

export interface PeriodoReport {
  periodo: Periodo;
  /** true while the período is abierto (live recompute); false once cerrado (frozen snapshot). */
  live: boolean;
  sections: PeriodoReportSections;
}

/** RF-22/RF-23: the 3-section período report — live while abierto, frozen once cerrado. */
export async function getPeriodoReport(periodoId: string): Promise<PeriodoReport> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/report`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Reporte de período failed (${res.status})`));
  }
  return res.json();
}

/** Client-requested (2026-08-22): CSV/XLSX download for the período report, same `<a href>` pattern as reportDownloadUrl (T11's per-job export). */
export function periodoReportDownloadUrl(periodoId: string, format: 'csv' | 'xlsx'): string {
  return `${API_BASE_URL}/api/periodos/${periodoId}/report?format=${format}`;
}

export interface TenantConfig {
  id: string;
  tolerancia_redondeo_ars: string;
}

export async function getTenantConfig(tenantId: string): Promise<TenantConfig> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/config`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Config fetch failed (${res.status})`));
  }
  return res.json();
}

export async function updateTenantConfig(tenantId: string, toleranciaRedondeoArs: number): Promise<TenantConfig> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tolerancia_redondeo_ars: toleranciaRedondeoArs }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `Config update failed (${res.status})`));
  }
  return res.json();
}
