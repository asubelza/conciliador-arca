import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
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
  validateTenantId,
  validateUploadFiles,
} from './upload-validation';
import { getReconciliationQueue } from './reconciliation.queue';
import { mapJobToStatusResponse } from './job-status';

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

    const sourceSystemFailure = validateContabilidadSourceSystem(contabilidadSourceSystem);
    if (sourceSystemFailure) {
      const body = 'error' in sourceSystemFailure ? { error: sourceSystemFailure.error } : {};
      throw new HttpException(body, sourceSystemFailure.status);
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
  async status(@Param('jobId') jobId: string) {
    const queue = getReconciliationQueue();
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new HttpException({ error: 'Reconciliation job not found' }, HttpStatus.NOT_FOUND);
    }
    const state = await job.getState();
    return mapJobToStatusResponse(state, job);
  }
}
