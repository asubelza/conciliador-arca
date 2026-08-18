/**
 * upload-validation.ts — T04, RF-01/RF-02 (voucher-ingestion.spec.md)
 *
 * Pure validation rules for POST /api/reconciliations. Kept dependency-free
 * (no NestJS/multer types) so it is testable in isolation and reusable from
 * both the controller and any future CLI/import tooling.
 *
 * Scope note: T04 only validates the request shape (exactly two files,
 * <=50MB each, csv/xlsx/xls extension). Actually staging the rows and
 * enqueuing the BullMQ job is T05 — this module does not touch the DB
 * or queue.
 */

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB, per RF-02
export const ALLOWED_EXTENSIONS = ['csv', 'xlsx', 'xls'] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/** The subset of Express.Multer.File this module actually needs. */
export interface UploadedFileLike {
  originalname: string;
  size: number;
}

export interface UploadFieldFiles {
  arca_file?: UploadedFileLike[];
  contabilidad_file?: UploadedFileLike[];
}

export type ValidationFailure =
  | { code: 'MISSING_FILES'; status: 400; error: string }
  | { code: 'FILE_TOO_LARGE'; status: 413 }
  | { code: 'INVALID_EXTENSION'; status: 415; error: string };

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === filename.length - 1) return '';
  return filename.slice(dotIndex + 1).toLowerCase();
}

function isAllowedExtension(filename: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(getExtension(filename));
}

/**
 * Validates a two-file upload against RF-01 (both files required) and RF-02
 * (size + extension whitelist). Returns `null` when the upload is valid, or
 * the first applicable `ValidationFailure` otherwise.
 *
 * Precedence (checked in this order, matching the RF-01/RF-02 scenarios):
 *   1. Both files present (400)
 *   2. Both files within the size limit (413)
 *   3. Both files have an allowed extension (415)
 */
export function validateUploadFiles(files: UploadFieldFiles): ValidationFailure | null {
  const arca = files.arca_file?.[0];
  const contabilidad = files.contabilidad_file?.[0];

  if (!arca || !contabilidad) {
    return {
      code: 'MISSING_FILES',
      status: 400,
      error: 'Both ARCA and contabilidad files are required',
    };
  }

  const uploaded = [arca, contabilidad];

  if (uploaded.some((f) => f.size > MAX_FILE_SIZE_BYTES)) {
    return { code: 'FILE_TOO_LARGE', status: 413 };
  }

  if (uploaded.some((f) => !isAllowedExtension(f.originalname))) {
    return {
      code: 'INVALID_EXTENSION',
      status: 415,
      error: 'Accepted types: csv, xlsx, xls',
    };
  }

  return null;
}
