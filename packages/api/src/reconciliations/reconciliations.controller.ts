import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { MAX_FILE_SIZE_BYTES, UploadFieldFiles, validateUploadFiles } from './upload-validation';

/**
 * T04 (RF-01/RF-02): validates the two-file upload contract and returns
 * 202/400/413/415 per voucher-ingestion.spec.md.
 *
 * The `fileSize` limit passed to FileFieldsInterceptor is enforced by multer
 * while streaming (no whole file is buffered); @nestjs/platform-express
 * already translates that rejection into a 413 PayloadTooLargeException
 * (and any other multer parsing error into a 400 BadRequestException)
 * before it reaches this handler — no custom exception filter needed here.
 * `validateUploadFiles` covers the two checks Nest/multer can't: the
 * RF-01 "both files required" 400 and the RF-02 extension whitelist 415.
 *
 * T05 scope (not yet implemented): actually streaming rows into
 * vouchers_staging via COPY FROM STDIN and enqueuing the BullMQ job. Until
 * then this handler returns a real job_id/status_url shape so the frontend
 * contract is stable, but no staging or queuing happens yet — see
 * openspec/tasks/mvp-carga-comprobantes.yaml T05.
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
      { limits: { fileSize: MAX_FILE_SIZE_BYTES } },
    ),
  )
  @HttpCode(HttpStatus.ACCEPTED)
  upload(@UploadedFiles() files: UploadFieldFiles) {
    const failure = validateUploadFiles(files ?? {});
    if (failure) {
      const body = 'error' in failure ? { error: failure.error } : {};
      throw new HttpException(body, failure.status);
    }

    const jobId = randomUUID();
    return {
      job_id: jobId,
      status_url: `/api/reconciliations/${jobId}/status`,
    };
  }
}
