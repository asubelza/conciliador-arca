import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_FILE_SIZE_BYTES,
  ContabilidadSourceSystem,
  getAllowedExtension,
  validateContabilidadSourceSystem,
  validatePeriodoIdFormat,
  validateTenantId,
  validateUploadFiles,
} from './upload-validation';
import { getReconciliationQueue } from './reconciliation.queue';
import { mapJobToStatusResponse } from './job-status';
import { getPgPool } from '../db/pg-pool';
import { buildDiffReportRows, toCsv, toXlsxBuffer } from './report-generator';
import type { PersistedResultRow, ReportSection } from './report-generator';
import { Classification } from 'shared-types';
import { logAuditEvent } from './audit-logger';
import { validateMarkRequest } from './marks-validation';
import { insertFeedbackMark } from './feedback-writer';
import { assertPeriodoOpenForUpload } from '../periodos/periodo-upload-guard';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import type { AuthenticatedUser } from '../auth/users-types';
import { assertTenantAccess } from '../auth/tenant-access';
import { assertRole } from '../auth/role-check';
import { buildReconciliationPreview, cleanupPreviewFiles } from './reconciliation-preview';

/**
 * Multer's `diskStorage` writes files to disk BEFORE `validateUploadFiles`/
 * `validateTenantId` run below, so a 400/415 response otherwise leaves
 * already-written files orphaned in the upload temp dir forever. Best-effort
 * cleanup: swallow failures (the file may already be gone, or this is a
 * best-effort GC, not something that should fail the HTTP response) but log
 * them so a persistent disk-fill issue is still visible.
 */
async function cleanupUploadedFiles(
  files: { arca_file?: Express.Multer.File[]; contabilidad_file?: Express.Multer.File[] } | undefined,
): Promise<void> {
  const uploaded = [...(files?.arca_file ?? []), ...(files?.contabilidad_file ?? [])];
  await Promise.all(
    uploaded.map(async (f) => {
      try {
        await fs.promises.unlink(f.path);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[reconciliations.controller] failed to clean up orphaned upload "${f.path}"`, err);
      }
    }),
  );
}

/**
 * T04+T05 (RF-01/RF-02/RF-03): validates the two-file upload contract,
 * streams both files to a temp dir on disk (multer diskStorage — never
 * buffers the whole file in process memory), and enqueues a BullMQ job that
 * stages the rows via COPY FROM STDIN (see reconciliation.worker.ts).
 *
 * The `job_id` returned here is the real BullMQ job id (T04 used to return
 * a disconnected `randomUUID()` placeholder — see reconciliations.controller
 * git history / openspec/progress/PR-2.md "Deviations" #3). T06 adds the
 * GET status poll endpoint that resolves this same id.
 */
@Controller('api/reconciliations')
@UseGuards(AuthGuard)
export class ReconciliationsController {
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'arca_file', maxCount: 1 },
        { name: 'contabilidad_file', maxCount: 1 },
      ],
      {
        limits: { fileSize: MAX_FILE_SIZE_BYTES },
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const dir = path.join(os.tmpdir(), 'conciliador-uploads');
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
          // Never interpolate `file.originalname` into the stored filename:
          // it is attacker-controlled (multipart filename header) and
          // multer's diskStorage does a plain path.join with whatever this
          // callback returns, so a name like "../../../evil.csv" would
          // escape the upload directory (path traversal). Only a
          // lowercased extension survives from the original name — the
          // extension itself is re-validated by upload-validation.ts
          // before the file is ever read.
          filename: (_req, file, cb) =>
            cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
        }),
      },
    ),
  )
  @HttpCode(HttpStatus.ACCEPTED)
  async upload(
    @UploadedFiles() files: { arca_file?: Express.Multer.File[]; contabilidad_file?: Express.Multer.File[] },
    @Body('tenant_id') tenantId: unknown,
    @Body('contabilidad_source_system') contabilidadSourceSystem: unknown,
    @Body('periodo_id') periodoId: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.validateUploadRequest(files, tenantId, contabilidadSourceSystem, periodoId, req.user!);

    const arcaFile = files.arca_file![0] as Express.Multer.File;
    const contabilidadFile = files.contabilidad_file![0] as Express.Multer.File;

    const queue = getReconciliationQueue();
    const jobId = randomUUID();

    await queue.add(
      'stage-and-normalize',
      {
        tenantId: tenantId as string,
        contabilidadSourceSystem: contabilidadSourceSystem as ContabilidadSourceSystem,
        periodoId: periodoId as string,
        arca: {
          filePath: arcaFile.path,
          originalName: arcaFile.originalname,
          extension: getAllowedExtension(arcaFile.originalname),
        },
        contabilidad: {
          filePath: contabilidadFile.path,
          originalName: contabilidadFile.originalname,
          extension: getAllowedExtension(contabilidadFile.originalname),
        },
      },
      {
        jobId,
        // BullMQ's default is `attempts: 1` — a transient DB/Redis blip
        // during staging would otherwise permanently fail the job with no
        // retry. 3 attempts with exponential backoff (2s, 4s, 8s) gives a
        // short-lived outage time to clear without the client having to
        // re-upload.
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    return {
      job_id: jobId,
      status_url: `/api/reconciliations/${jobId}/status`,
    };
  }

  /**
   * Previsualización de datos al cargar (pedido del cliente, 2026-08-23,
   * rediseño UI/UX): mismo contrato de request que `POST
   * /api/reconciliations` (mismos dos archivos + campos), pero de solo
   * lectura — parsea ambos archivos con el mismo adaptador/normalizador
   * que el worker real usa (ver reconciliation-preview.ts) y devuelve las
   * filas interpretadas para que el contador las revise antes de conciliar
   * de verdad. No escribe en `vouchers_staging` ni en ninguna otra tabla,
   * no encola ningún job, y borra los dos archivos temporales de multer
   * antes de responder — a diferencia de `upload` arriba, que se los deja
   * al worker para que los borre al terminar el job real.
   *
   * Reutiliza exactamente la misma cadena de validación que `upload`
   * (incluido el chequeo de que el período esté abierto) para que una
   * previsualización nunca prometa algo que la carga real después
   * rechazaría.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'arca_file', maxCount: 1 },
        { name: 'contabilidad_file', maxCount: 1 },
      ],
      {
        limits: { fileSize: MAX_FILE_SIZE_BYTES },
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const dir = path.join(os.tmpdir(), 'conciliador-uploads');
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
          // Same path-traversal fix as the upload endpoint above — only a
          // lowercased extension survives from the original name.
          filename: (_req, file, cb) =>
            cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
        }),
      },
    ),
  )
  async preview(
    @UploadedFiles() files: { arca_file?: Express.Multer.File[]; contabilidad_file?: Express.Multer.File[] },
    @Body('tenant_id') tenantId: unknown,
    @Body('contabilidad_source_system') contabilidadSourceSystem: unknown,
    @Body('periodo_id') periodoId: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.validateUploadRequest(files, tenantId, contabilidadSourceSystem, periodoId, req.user!);

    const arcaFile = files.arca_file![0] as Express.Multer.File;
    const contabilidadFile = files.contabilidad_file![0] as Express.Multer.File;

    try {
      return await buildReconciliationPreview({
        arca: { filePath: arcaFile.path, extension: getAllowedExtension(arcaFile.originalname) },
        contabilidad: {
          filePath: contabilidadFile.path,
          extension: getAllowedExtension(contabilidadFile.originalname),
        },
        contabilidadSourceSystem: contabilidadSourceSystem as ContabilidadSourceSystem,
      });
    } finally {
      await cleanupPreviewFiles([arcaFile.path, contabilidadFile.path]);
    }
  }

  /**
   * T06 (RF-04): poll a job's status. `jobId` is the same id returned by
   * POST /api/reconciliations (it's the literal BullMQ job id — see
   * `{ jobId }` passed to `queue.add` above), so no separate lookup table
   * is needed.
   */
  @Get(':jobId/status')
  async status(@Param('jobId') jobId: string, @Req() req: AuthenticatedRequest) {
    const queue = getReconciliationQueue();
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new HttpException({ error: 'Reconciliation job not found' }, HttpStatus.NOT_FOUND);
    }

    const authFailure = await assertTenantAccess(getPgPool(), req.user!, job.data.tenantId as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const state = await job.getState();
    return mapJobToStatusResponse(state, job);
  }

  /**
   * T11 (RF-10): download the diff report for a completed job.
   *   404 - job doesn't exist
   *   409 - job exists but hasn't finished processing yet (nothing to report)
   *   400 - `format` isn't one of csv/xlsx/json
   * `job.data.tenantId` (not a client-supplied query param) scopes the DB
   * read, so a caller can't pull another tenant's results by guessing a
   * job_id that belongs to a different tenant_id.
   *
   * T13 adds `format=json`: RF-10 only specifies csv/xlsx (on-demand
   * *download*), but the frontend's diff table viewer needs the same rows
   * as structured data to render, not a file to save — rather than stand up
   * a second endpoint for what's the same query + buildDiffReportRows call,
   * `format=json` returns `{ rows }` as a normal JSON body (no
   * Content-Disposition — this response is for the page to render, not to
   * save as a file).
   */
  /**
   * `classification` (2026-08-23, client request — "Ver pendientes
   * sistema"): optional filter to a single section (e.g.
   * `unmatched-contabilidad`, the comprobantes del sistema contable sin
   * match en ARCA) — the frontend button of the same name filters the
   * on-screen table client-side from the already-loaded `format=json` rows,
   * and passes this same param through to csv/xlsx so the download matches
   * what's on screen instead of always exporting every section.
   */
  private static readonly FILTERABLE_CLASSIFICATIONS: readonly ReportSection[] = [
    Classification.Matched,
    Classification.UnmatchedArca,
    Classification.UnmatchedContabilidad,
    Classification.Errors,
  ];

  @Get(':jobId/report')
  async report(
    @Param('jobId') jobId: string,
    @Query('format') format: unknown,
    @Query('classification') classification: unknown,
    @Res() res: Response,
    @Req() req: AuthenticatedRequest,
  ) {
    const job = await this.getCompletedJobOrThrow(jobId);

    const resolvedFormat = format === undefined ? 'csv' : format;
    if (resolvedFormat !== 'csv' && resolvedFormat !== 'xlsx' && resolvedFormat !== 'json') {
      throw new HttpException({ error: "format must be 'csv', 'xlsx', or 'json'" }, HttpStatus.BAD_REQUEST);
    }

    if (
      classification !== undefined &&
      !ReconciliationsController.FILTERABLE_CLASSIFICATIONS.includes(classification as ReportSection)
    ) {
      throw new HttpException(
        { error: `classification must be one of: ${ReconciliationsController.FILTERABLE_CLASSIFICATIONS.join(', ')}` },
        HttpStatus.BAD_REQUEST,
      );
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, job.data.tenantId as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const { rows } = await pool.query<PersistedResultRow>(
      `SELECT tipo_clasificacion, composite_key, arca_row, contabilidad_row, iva_impacto
         FROM reconciliation_results
        WHERE tenant_id = $1 AND job_id = $2`,
      [job.data.tenantId, jobId],
    );

    let reportRows = buildDiffReportRows(rows);
    if (classification !== undefined) {
      reportRows = reportRows.filter((r) => r.classification === classification);
    }

    // T12 (RF-11): every export is logged. Awaited before the response is
    // sent so a logging failure surfaces as an error rather than a silently
    // unaudited download.
    await logAuditEvent(pool, {
      tenantId: job.data.tenantId,
      action: 'export',
      entity: 'reconciliation_job',
      entityId: jobId,
      details: { format: resolvedFormat, rows: reportRows.length, classification: classification ?? null },
    });

    if (resolvedFormat === 'json') {
      res.json({ rows: reportRows });
      return;
    }

    if (resolvedFormat === 'xlsx') {
      const sections = classification === undefined ? undefined : [classification as ReportSection];
      const buffer = sections ? await toXlsxBuffer(reportRows, sections) : await toXlsxBuffer(reportRows);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="reconciliation-${jobId}.xlsx"`,
        })
        .send(buffer);
      return;
    }

    const csv = toCsv(reportRows);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reconciliation-${jobId}.csv"`,
      })
      .send(csv);
  }

  /**
   * T12 (RF-11): user marks a voucher `revisado` (reviewed) or `explicado`
   * (explained, with a note) — persisted to `feedback_loop`, and logged to
   * `audit_trail` as `action: 'user_mark'`. Same 404/409 guard as the report
   * endpoint above: a mark only makes sense once the job's results exist.
   */
  @Post(':jobId/marks')
  @HttpCode(HttpStatus.CREATED)
  async createMark(@Param('jobId') jobId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const job = await this.getCompletedJobOrThrow(jobId);

    const validation = validateMarkRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, job.data.tenantId as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const mark = await insertFeedbackMark(pool, job.data.tenantId, validation.value);

    await logAuditEvent(pool, {
      tenantId: job.data.tenantId,
      userId: validation.value.user_id,
      action: 'user_mark',
      entity: 'feedback_loop',
      entityId: mark.id,
      details: { composite_key: validation.value.composite_key, classification: validation.value.classification },
    });

    return mark;
  }

  /**
   * Shared by `upload` and `preview` — identical request contract, same
   * checks in the same order (files -> tenant_id -> rol -> acceso al
   * tenant -> sistema contable -> período abierto). Extracted so the
   * previsualización nunca pueda aceptar algo que la carga real después
   * rechazaría, sin duplicar la cadena de validación en los dos métodos.
   * Throws an `HttpException` itself (matching this file's existing style)
   * rather than returning a failure — both callers just `await` it.
   */
  private async validateUploadRequest(
    files: { arca_file?: Express.Multer.File[]; contabilidad_file?: Express.Multer.File[] } | undefined,
    tenantId: unknown,
    contabilidadSourceSystem: unknown,
    periodoId: unknown,
    user: AuthenticatedUser,
  ): Promise<void> {
    // multer's diskStorage already wrote the uploaded file(s) to disk before
    // any of these checks run, so every failure path below must clean them
    // up explicitly — otherwise a rejected upload leaks temp files forever
    // (shared by `upload` and `preview`, both of which call this helper).
    const filesFailure = validateUploadFiles(files ?? {});
    if (filesFailure) {
      await cleanupUploadedFiles(files);
      const body = 'error' in filesFailure ? { error: filesFailure.error } : {};
      throw new HttpException(body, filesFailure.status);
    }

    const tenantFailure = validateTenantId(tenantId);
    if (tenantFailure) {
      await cleanupUploadedFiles(files);
      const body = 'error' in tenantFailure ? { error: tenantFailure.error } : {};
      throw new HttpException(body, tenantFailure.status);
    }

    const roleFailure = assertRole(user, ['admin', 'colaborador']);
    if (roleFailure) {
      await cleanupUploadedFiles(files);
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const authFailure = await assertTenantAccess(getPgPool(), user, tenantId as string);
    if (authFailure) {
      await cleanupUploadedFiles(files);
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const sourceSystemFailure = validateContabilidadSourceSystem(contabilidadSourceSystem);
    if (sourceSystemFailure) {
      await cleanupUploadedFiles(files);
      const body = 'error' in sourceSystemFailure ? { error: sourceSystemFailure.error } : {};
      throw new HttpException(body, sourceSystemFailure.status);
    }

    // T19 (RF-13): periodo_id is required and must reference an existing,
    // open período for this tenant. Format checked first (pure, cheap);
    // the DB-backed existence/estado check only runs once the id is at
    // least well-formed.
    const periodoFormatFailure = validatePeriodoIdFormat(periodoId);
    if (periodoFormatFailure) {
      await cleanupUploadedFiles(files);
      const body = 'error' in periodoFormatFailure ? { error: periodoFormatFailure.error } : {};
      throw new HttpException(body, periodoFormatFailure.status);
    }

    const periodoGuardFailure = await assertPeriodoOpenForUpload(
      getPgPool(),
      tenantId as string,
      periodoId as string,
    );
    if (periodoGuardFailure) {
      await cleanupUploadedFiles(files);
      throw new HttpException({ error: periodoGuardFailure.error }, periodoGuardFailure.status);
    }
  }

  private async getCompletedJobOrThrow(jobId: string) {
    const queue = getReconciliationQueue();
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new HttpException({ error: 'Reconciliation job not found' }, HttpStatus.NOT_FOUND);
    }
    const state = await job.getState();
    if (state !== 'completed') {
      throw new HttpException(
        { error: `Reconciliation job is not completed yet (status: ${state})` },
        HttpStatus.CONFLICT,
      );
    }
    return job;
  }
}
