/**
 * lib/api.ts — T13: thin fetch wrapper around the NestJS API
 * (packages/api/src/reconciliations/reconciliations.controller.ts).
 *
 * Kept dependency-free (no framework imports) so it's testable in isolation
 * with a mocked `fetch`, same rationale as upload-validation.ts on the API
 * side.
 *
 * T39 (Fase 3, autenticacion-roles): every endpoint below now requires a
 * bearer token (Fase 2 protected them all server-side) — `authHeaders()`
 * attaches it from lib/session.ts, and `handleUnauthorized` clears the
 * session on any 401 so the app falls back to the login screen
 * automatically (architecture.md: "Un 401 en cualquier request → limpia el
 * token y vuelve a login").
 */
import { clearSession, getSession } from './session';
import type { PeriodoReabrirResponse, PeriodoDeleteResponse } from 'shared-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const session = getSession();
  return session ? { ...extra, Authorization: `Bearer ${session.token}` } : extra;
}

/** Any 401 means the token is missing/invalid/expired — drop the session so the UI falls back to login. */
function handleUnauthorized(res: Response): void {
  if (res.status === 401) {
    clearSession();
  }
}

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

/**
 * Pantalla resumen (pedido del cliente, 2026-08-23): el backend ahora expone
 * los 5 conteos por clasificación además de arca_rows/contabilidad_rows
 * (ver job-status.ts) — insumo directo de UploadSummary.tsx.
 */
export interface StatusResponse {
  status: ReconciliationStatus;
  counts?: {
    arca_rows: number;
    contabilidad_rows: number;
    matched: number;
    'unmatched-arca': number;
    'unmatched-contabilidad': number;
    duplicates: number;
    errors: number;
  };
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

// --- autenticación (T39, Fase 3) ---

export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'colaborador' | 'cliente';
  display_name: string | null;
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
}

/** POST /api/auth/login is the one endpoint that never needs a bearer token — it's what issues one. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    // Login's own 401 (bad credentials) must NOT trigger handleUnauthorized's
    // "clear session" — there's no session yet to clear, and doing so would
    // be a no-op at best, confusing at worst.
    throw new Error(await readErrorMessage(res, `Login failed (${res.status})`));
  }
  return res.json();
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

  const res = await fetch(`${API_BASE_URL}/api/reconciliations`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Upload failed (${res.status})`));
  }
  return res.json();
}

/**
 * Previsualización de carga (pedido del cliente, 2026-08-23, feature 1 de
 * 3): mismo shape que `PreviewResult`/`PreviewSide`/`PreviewRow` en
 * reconciliation-preview.ts del lado del API — se llama a
 * POST /api/reconciliations/preview con los mismos dos archivos que
 * después se reenvían a uploadReconciliation() si el contador confirma.
 */
export interface PreviewRow {
  /** false cuando no se pudo resolver el tipo de comprobante AFIP — la fila igual se muestra, marcada. */
  ok: boolean;
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  fecha_emision: string;
  importe_total_ars: number;
}

export interface PreviewSide {
  total: number;
  ok: number;
  errors: number;
  rows: PreviewRow[];
}

export interface PreviewResult {
  arca: PreviewSide;
  contabilidad: PreviewSide;
}

export async function previewReconciliation(params: {
  tenantId: string;
  periodoId: string;
  contabilidadSourceSystem: ContabilidadSourceSystem;
  arcaFile: File;
  contabilidadFile: File;
}): Promise<PreviewResult> {
  const form = new FormData();
  form.append('tenant_id', params.tenantId);
  form.append('periodo_id', params.periodoId);
  form.append('contabilidad_source_system', params.contabilidadSourceSystem);
  form.append('arca_file', params.arcaFile);
  form.append('contabilidad_file', params.contabilidadFile);

  const res = await fetch(`${API_BASE_URL}/api/reconciliations/preview`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Preview failed (${res.status})`));
  }
  return res.json();
}

export async function getStatus(jobId: string): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/reconciliations/${jobId}/status`, { headers: authHeaders() });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Status check failed (${res.status})`));
  }
  return res.json();
}

export async function getReportRows(jobId: string): Promise<DiffReportRow[]> {
  const res = await fetch(`${API_BASE_URL}/api/reconciliations/${jobId}/report?format=json`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Report fetch failed (${res.status})`));
  }
  const data = await res.json();
  return data.rows;
}

function reportUrl(jobId: string, format: 'csv' | 'xlsx', classification?: string): string {
  const base = `${API_BASE_URL}/api/reconciliations/${jobId}/report?format=${format}`;
  return classification ? `${base}&classification=${encodeURIComponent(classification)}` : base;
}

/**
 * T39 (Fase 3): every download endpoint has required a bearer token since
 * Fase 2 — a plain `<a href>` can't carry a custom header, so navigating to
 * it directly now 401s. This fetches with the token, then hands the
 * browser the resulting blob through a throwaway `<a download>` so the
 * save-file UX is the same as clicking a real link. `filenameFromHeader`
 * reuses the exact filename the API already put in Content-Disposition
 * (`periodo-report-exporter.ts`/`report-generator.ts`) rather than
 * reconstructing it client-side.
 */
function filenameFromContentDisposition(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition');
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match ? match[1] : fallback;
}

async function downloadAuthenticated(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Download failed (${res.status})`));
  }
  const filename = filenameFromContentDisposition(res, fallbackFilename);
  const blob = await res.blob();
  if (typeof window === 'undefined') return;
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(blobUrl);
}

/**
 * T11/T13: downloads a single job's diff report (RF-10). `classification`
 * (2026-08-23, "Ver pendientes sistema") narrows the download to one
 * section — e.g. `unmatched-contabilidad` — matching the on-screen filtered
 * table in ReportViewer.tsx instead of always exporting every section.
 */
export async function downloadReconciliationReport(
  jobId: string,
  format: 'csv' | 'xlsx',
  classification?: string,
): Promise<void> {
  await downloadAuthenticated(reportUrl(jobId, format, classification), `reconciliation-${jobId}.${format}`);
}

export async function createMark(
  jobId: string,
  mark: { composite_key: string; classification: UserMarkClassification; note?: string },
): Promise<MarkResponse> {
  const res = await fetch(`${API_BASE_URL}/api/reconciliations/${jobId}/marks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(mark),
  });
  if (!res.ok) {
    handleUnauthorized(res);
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
  const res = await fetch(`${API_BASE_URL}/api/periodos?tenant_id=${encodeURIComponent(tenantId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Períodos fetch failed (${res.status})`));
  }
  const data = await res.json();
  return data.periodos;
}

/** `mes` accepts 'YYYY-MM' or 'YYYY-MM-DD' — the API normalizes to the 1st of the month. */
export async function createPeriodo(tenantId: string, mes: string): Promise<Periodo> {
  const res = await fetch(`${API_BASE_URL}/api/periodos`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ tenant_id: tenantId, mes }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
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
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(cerradoPor ? { cerrado_por: cerradoPor } : {}),
  });
  if (!res.ok) {
    handleUnauthorized(res);
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
  // 'archivado' added 2026-10-12 (Histórico filters + "Archivar") — a
  // pendiente ARCA voucher the contador marked as no longer relevant.
  estado: 'pendiente' | 'conciliado' | 'archivado';
  periodo_alta_id: string;
}

export type PeriodoClassification =
  | 'conciliado_ok'
  | 'con_divergencia'
  | 'posible_duplicado_en_sistema'
  | 'no_existe_en_arca'
  | 'pendiente_en_arca'
  | 'posible_coincidencia';

/** RF-09: the most recent prior feedback_loop mark for a row's composite_key, from any período — or null if the contador never marked it before. */
export interface PeriodoReportFeedback {
  classification: string;
  note: string | null;
  created_at: string;
}

export interface PeriodoReportRow {
  classification: PeriodoClassification;
  composite_key: string;
  sistema: PeriodoVoucherRow | null;
  arca: PeriodoVoucherRow | null;
  divergencia_ars: number | null;
  antiguedad_meses: number | null;
  /** RF-04: only set for 'posible_coincidencia' — why these two rows were suggested as a match. */
  similarity_reason: string | null;
  /** RF-09: shown, never hidden (RNF-07) — used only to sort a reviewed row later within its section. */
  feedback_previo: PeriodoReportFeedback | null;
}

export interface PeriodoReportSections {
  conciliados_ok: PeriodoReportRow[];
  discrepancias_y_alertas: PeriodoReportRow[];
  pendientes_en_arca: PeriodoReportRow[];
  /** RF-04: similarity candidates awaiting the contador's confirmar/descartar decision. */
  posibles_coincidencias: PeriodoReportRow[];
}

export interface PeriodoReport {
  periodo: Periodo;
  /** true while the período is abierto (live recompute); false once cerrado (frozen snapshot). */
  live: boolean;
  sections: PeriodoReportSections;
}

/** RF-22/RF-23: the 3-section período report — live while abierto, frozen once cerrado. */
export async function getPeriodoReport(periodoId: string): Promise<PeriodoReport> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/report`, { headers: authHeaders() });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Reporte de período failed (${res.status})`));
  }
  return res.json();
}

export type CoincidenciaAccion = 'confirmar' | 'descartar';

export interface CoincidenciaResponse {
  tenant_id: string;
  sistema_voucher_id: string;
  arca_voucher_id: string;
  status: 'confirmado' | 'descartado';
  created_by: string | null;
  created_at: string;
}

/** RF-04/RF-13: contador confirma o descarta una sugerencia de 'posible_coincidencia'. A 'confirmado' pairing is treated like an exact match on the NEXT report read (see periodo-matching-engine.ts). */
export async function confirmarCoincidencia(
  periodoId: string,
  sistemaVoucherId: string,
  arcaVoucherId: string,
  accion: CoincidenciaAccion,
): Promise<CoincidenciaResponse> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/coincidencias`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sistema_voucher_id: sistemaVoucherId, arca_voucher_id: arcaVoucherId, accion }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Coincidencia failed (${res.status})`));
  }
  return res.json();
}

export interface ResolverPendienteResponse {
  id: string;
  estado: 'conciliado';
}

/**
 * 2026-08-23 (client request, feature 2 de 3): "Marcar como resuelto sin
 * pareja" — para un comprobante de la sección Pendientes en ARCA que nunca
 * va a tener su par en el sistema contable (ej. cargado en ARCA muchos
 * meses antes de que el cliente empezara a usar el sistema). A diferencia
 * de `confirmarCoincidencia`, esto resuelve un solo comprobante ARCA, sin
 * vincularlo a ningún comprobante del sistema.
 */
export async function resolverPendienteArca(
  periodoId: string,
  arcaVoucherId: string,
  nota?: string,
): Promise<ResolverPendienteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/pendientes-arca-resolver`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ arca_voucher_id: arcaVoucherId, nota: nota ?? null }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Resolver pendiente failed (${res.status})`));
  }
  return res.json();
}

/**
 * RF-09: período-scoped mark (`revisado`/`explicado`), feeding
 * attachFeedbackAndReprioritize on the API side. The authenticated user id
 * is applied server-side from the bearer token — no user_id in this
 * request body (see periodos.controller.ts's `mark` handler doc).
 */
export async function createPeriodoMark(
  periodoId: string,
  compositeKey: string,
  classification: UserMarkClassification,
  note?: string,
): Promise<MarkResponse> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/marks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ composite_key: compositeKey, classification, note: note ?? null }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Mark failed (${res.status})`));
  }
  return res.json();
}

function periodoReportUrl(periodoId: string, format: 'csv' | 'xlsx', classification?: string): string {
  const base = `${API_BASE_URL}/api/periodos/${periodoId}/report?format=${format}`;
  return classification === undefined ? base : `${base}&classification=${encodeURIComponent(classification)}`;
}

/**
 * Client-requested (2026-08-22): CSV/XLSX download for the período report —
 * same authenticated-blob pattern as downloadReconciliationReport.
 * `classification` (2026-08-23, "Ver pendientes sistema") is optional so the
 * download matches whatever's currently on screen in PeriodoReportViewer.
 */
export async function downloadPeriodoReport(
  periodoId: string,
  mes: string,
  format: 'csv' | 'xlsx',
  classification?: string,
): Promise<void> {
  await downloadAuthenticated(periodoReportUrl(periodoId, format, classification), `periodo-${mes}-${periodoId}.${format}`);
}

export interface TenantConfig {
  id: string;
  tolerancia_redondeo_ars: string;
  /** RF-13 follow-up: date tolerance for the fecha/importe similarity fallback (RF-04), same per-tenant-config pattern as tolerancia_redondeo_ars. */
  tolerancia_dias_fecha: number;
}

export async function getTenantConfig(tenantId: string): Promise<TenantConfig> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/config`, { headers: authHeaders() });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Config fetch failed (${res.status})`));
  }
  return res.json();
}

/**
 * 2026-08-23 (client request, feature 3 de 3): "pantalla donde muestre el
 * resumen de unmatch de arca... tomando como filtro desde el mes en que
 * por primera vez el cliente empezo a usar el sistema" — tenant-wide, not
 * scoped to any one período (see pendientes-historico.ts). `excluidos_previos_a_alta`
 * is shown separately rather than dropped (RNF-07: "nunca ocultar") so a
 * client who mistakenly uploads a historical ARCA file is visible here too,
 * just not mixed into the "real" pendientes list.
 */
export interface PendientesHistoricoRow extends PeriodoVoucherRow {
  /** Meses entre la fecha de emisión y hoy — mismo cálculo que antiguedad_meses (RF-19), pero contra la fecha actual, no contra el mes de un período. `null` si la fila no tiene fecha. */
  antiguedad_meses: number | null;
}

export interface PendientesHistoricoResult {
  tenant: { id: string; name: string; created_at: string };
  pendientes: PendientesHistoricoRow[];
  count_pendientes: number;
  excluidos_previos_a_alta: PendientesHistoricoRow[];
  count_excluidos_previos_a_alta: number;
  /** 2026-10-12 (Histórico filters + "Archivar"): vouchers the contador deliberately archived — see pendientes-historico.ts's own doc on this bucket. */
  archivados: PendientesHistoricoRow[];
  count_archivados: number;
}

export async function getPendientesHistorico(tenantId: string): Promise<PendientesHistoricoResult> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/pendientes-historico`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Pendientes histórico fetch failed (${res.status})`));
  }
  return res.json();
}

/**
 * 2026-10-12 (manual ARCA voucher creation): request body for
 * POST /api/tenants/:id/comprobantes-arca — a comprobante the contador
 * found directly in AFIP's own portal, never captured by any uploaded
 * ARCA file, registered by hand so it enters the normal matching engine as
 * a regular pendiente ARCA voucher. `iva` is optional (defaults to 0
 * server-side, see comprobante-arca-manual-validation.ts).
 */
export interface ComprobanteArcaManualRequest {
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  fecha_emision: string;
  importe_total_ars: number;
  iva?: number;
}

/** Mirrors PeriodoVoucherRow's shape — the created/upserted vouchers_canonical row. */
export interface ComprobanteArcaManualResponse {
  id: string;
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  importe_total: number | null;
  iva: number | null;
  fecha: string | null;
  file_source: 'arca';
  estado: 'pendiente' | 'conciliado';
  periodo_alta_id: string | null;
}

/** 2026-10-12 (manual ARCA voucher creation): registers a comprobante by hand — see tenants.controller.ts's createComprobanteArca. */
export async function createVoucherArcaManual(
  tenantId: string,
  payload: ComprobanteArcaManualRequest,
): Promise<ComprobanteArcaManualResponse> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/comprobantes-arca`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Comprobante ARCA manual failed (${res.status})`));
  }
  return res.json();
}

/** Response for the single-voucher archive endpoint — mirrors ResolverPendienteResponse's shape (that action's own closest precedent). */
export interface ArchivarComprobanteResponse {
  id: string;
  estado: 'archivado';
}

/**
 * 2026-10-12 (Histórico filters + "Archivar"): marks one pendiente ARCA
 * voucher as "no longer relevant" — see tenants.controller.ts's
 * archivarComprobante for the validation/role/409 rules this enforces
 * server-side.
 */
export async function archivarComprobanteArca(
  tenantId: string,
  voucherId: string,
  nota?: string,
): Promise<ArchivarComprobanteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/comprobantes/${voucherId}/archivar`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ nota: nota ?? null }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Archivar comprobante failed (${res.status})`));
  }
  return res.json();
}

export type ArchivarLoteSkipReason = 'not_found' | 'wrong_tenant' | 'wrong_file_source' | 'already_conciliado' | 'already_archivado';

export interface ArchivarLoteItemResult {
  voucher_id: string;
  status: 'archived' | 'skipped';
  reason?: ArchivarLoteSkipReason;
}

export interface ArchivarComprobantesLoteResponse {
  results: ArchivarLoteItemResult[];
}

/**
 * 2026-10-12 (Histórico filters + "Archivar"): bulk version — never an
 * all-or-nothing rollback server-side (RNF-07 "nunca ocultar"), so the
 * caller always gets a per-id result back, even for a batch that's a mix
 * of valid and invalid ids.
 */
export async function archivarComprobantesArcaLote(
  tenantId: string,
  voucherIds: string[],
  nota?: string,
): Promise<ArchivarComprobantesLoteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/comprobantes/archivar-lote`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ voucher_ids: voucherIds, nota: nota ?? null }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Archivar comprobantes (lote) failed (${res.status})`));
  }
  return res.json();
}

/** Response for the desarchivar endpoint — the exact inverse of ArchivarComprobanteResponse. */
export interface DesarchivarComprobanteResponse {
  id: string;
  estado: 'pendiente';
}

/**
 * 2026-10-12 ("Match manual" para no_existe_en_arca): la contraparte exacta
 * de `archivarComprobanteArca` — usada por MatchManualModal.tsx's tab
 * "Buscar en archivados" cuando el comprobante correcto resultó estar
 * archivado. SIEMPRE se llama antes de `confirmarCoincidencia`, nunca
 * después — ver tenants.controller.ts's desarchivarComprobante for el
 * detalle server-side (estado debe ser 'archivado', 409 si no).
 */
export async function desarchivarComprobanteArca(
  tenantId: string,
  voucherId: string,
): Promise<DesarchivarComprobanteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/comprobantes/${voucherId}/desarchivar`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Desarchivar comprobante failed (${res.status})`));
  }
  return res.json();
}

/** The API requires both fields on every PUT (see tenants-validation.ts) — tolerancia_dias_fecha is not optional here either. */
export async function updateTenantConfig(
  tenantId: string,
  toleranciaRedondeoArs: number,
  toleranciaDiasFecha: number,
): Promise<TenantConfig> {
  const res = await fetch(`${API_BASE_URL}/api/tenants/${tenantId}/config`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tolerancia_redondeo_ars: toleranciaRedondeoArs,
      tolerancia_dias_fecha: toleranciaDiasFecha,
    }),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Config update failed (${res.status})`));
  }
  return res.json();
}

/**
 * Reabrir un período cerrado — POST /api/periodos/:id/reabrir (RF-30/RF-33).
 * Returns the reopened período plus how much of cierre's write set was
 * undone (shared-types `PeriodoReabrirResponse`).
 */
export async function reabrirPeriodo(periodoId: string): Promise<PeriodoReabrirResponse> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}/reabrir`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Reabrir failed (${res.status})`));
  }
  return res.json();
}

/**
 * Eliminar un período (hybrid guard) — DELETE /api/periodos/:id (RF-35).
 * Returns `PeriodoDeleteResponse` on success (shared-types).
 */
export async function eliminarPeriodo(periodoId: string): Promise<PeriodoDeleteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/periodos/${periodoId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(await readErrorMessage(res, `Eliminar failed (${res.status})`));
  }
  return res.json();
}
