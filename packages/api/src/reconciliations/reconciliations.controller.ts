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
import type { PersistedResultRow } from './report-generator';
import { logAuditEvent } from './audit-logger';
import { validateMarkRequest } from './marks-validation';
import { insertFeedbackMark } from './feedback-writer';
import { assertPeriodoOpenForUpload } from '../periodos/periodo-upload-guard';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import { assertTenantAccess } from '../auth/tenant-access';
import { assertRole } from '../auth/role-check';

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
          filename: (_req, file, cb) => cb(null, `${randomUUID()}-${file.originalname}`),
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
    const filesFailure = validateUploadFiles(files ?? {});
    if (filesFailure) {
      const body = 'error' in filesFailure ? { error: filesFailure.error } : {};
      throw new HttpException(body, filesFailure.status);
    }

    const tenantFailure = validateTenantId(tenantId);
    if (tenantFailure) {
      const body = 'error' in tenantFailure ? { error: tenantFailure.error } : {};
      throw new HttpException(body, tenantFailure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const authFailure = await assertTenantAccess(getPgPool(), req.user!, tenantId as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const sourceSystemFailure = validateContabilidadSourceSystem(contabilidadSourceSystem);
    if (sourceSystemFailure) {
      const body = 'error' in sourceSystemFailure ? { error: sourceSystemFailure.error } : {};
      throw new HttpException(body, sourceSystemFailure.status);
    }

    // T19 (RF-13): periodo_id is required and must reference an existing,
    // open período for this tenant. Format checked first (pure, cheap);
    // the DB-backed existence/estado check only runs once the id is at
    // least well-formed.
    const periodoFormatFailure = validatePeriodoIdFormat(periodoId);
    if (periodoFormatFailure) {
      const body = 'error' in periodoFormatFailure ? { error: periodoFormatFailure.error } : {};
      throw new HttpException(body, periodoFormatFailure.status);
    }

    const periodoGuardFailure = await assertPeriodoOpenForUpload(
      getPgPool(),
      tenantId as string,
      periodoId as string,
    );
    if (periodoGuardFailure) {
      throw new HttpException({ error: periodoGuardFailure.error }, periodoGuardFailure.status);
    }

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
      { jobId },
    );

    return {
      job_id: jobId,
      status_url: `/api/reconciliations/${jobId}/status`,
    };
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
  @Get(':jobId/report')
  async report(
    @Param('jobId') jobId: string,
    @Query('format') format: unknown,
    @Res() res: Response,
    @Req() req: AuthenticatedRequest,
  ) {
    const job = await this.getCompletedJobOrThrow(jobId);

    const resolvedFormat = format === undefined ? 'csv' : format;
    if (resolvedFormat !== 'csv' && resolvedFormat !== 'xlsx' && resolvedFormat !== 'json') {
      throw new HttpException({ error: "format must be 'csv', 'xlsx', or 'json'" }, HttpStatus.BAD_REQUEST);
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

    const reportRows = buildDiffReportRows(rows);

    // T12 (RF-11): every export is logged. Awaited before the response is
    // sent so a logging failure surfaces as an error rather than a silently
    // unaudited download.
    await logAuditEvent(pool, {
      tenantId: job.data.tenantId,
      action: 'export',
      entity: 'reconciliation_job',
      entityId: jobId,
      details: { format: resolvedFormat, rows: reportRows.length },
    });

    if (resolvedFormat === 'json') {
      res.json({ rows: reportRows });
      return;
    }

    if (resolvedFormat === 'xlsx') {
      const buffer = await toXlsxBuffer(reportRows);
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
