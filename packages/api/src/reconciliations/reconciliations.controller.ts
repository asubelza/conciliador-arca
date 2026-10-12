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
  getAllowedExtension,
  validateTenantId,
  validateUploadFiles,
} from './upload-validation';
import { getReconciliationQueue } from './reconciliation.queue';
import { mapJobToStatusResponse } from './job-status';

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
  ) {
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

    const arcaFile = files.arca_file![0] as Express.Multer.File;
    const contabilidadFile = files.contabilidad_file![0] as Express.Multer.File;

    const queue = getReconciliationQueue();
    const jobId = randomUUID();

    await queue.add(
      'stage-and-normalize',
      {
        tenantId: tenantId as string,
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
