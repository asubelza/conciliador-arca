import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  getAllowedExtension,
  validateContabilidadSourceSystem,
  validateTenantId,
  validateUploadFiles,
} from './upload-validation';

/**
 * T04 — RF-01 / RF-02 (openspec/specs/mvp-carga-comprobantes/voucher-ingestion.spec.md)
 *
 * Pure-function unit tests for the validation rules, independent of NestJS/HTTP,
 * so the 400/413/415 decision logic is exhaustively covered without spinning up
 * a server. reconciliations.controller.test.ts covers the HTTP wiring.
 */
function file(originalname: string, size: number) {
  return { originalname, size };
}

describe('T04: validateUploadFiles (RF-01, RF-02)', () => {
  it('exposes a 50MB limit and the csv/xlsx/xls whitelist', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
    expect(ALLOWED_EXTENSIONS).toEqual(['csv', 'xlsx', 'xls']);
  });

  describe('RF-01: exactly two files required', () => {
    it('returns null (valid) when both files are present and well-formed', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.csv', 1024)],
        contabilidad_file: [file('contabilidad.xlsx', 2048)],
      });
      expect(result).toBeNull();
    });

    it('returns 400 when contabilidad_file is missing', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.csv', 1024)],
      });
      expect(result).toEqual({
        code: 'MISSING_FILES',
        status: 400,
        error: 'Both ARCA and contabilidad files are required',
      });
    });

    it('returns 400 when arca_file is missing', () => {
      const result = validateUploadFiles({
        contabilidad_file: [file('contabilidad.csv', 1024)],
      });
      expect(result?.status).toBe(400);
    });

    it('returns 400 when no files are present at all', () => {
      const result = validateUploadFiles({});
      expect(result).toEqual({
        code: 'MISSING_FILES',
        status: 400,
        error: 'Both ARCA and contabilidad files are required',
      });
    });
  });

  describe('RF-02: 50MB size limit', () => {
    it('returns 413 when the ARCA file exceeds 50MB', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.csv', MAX_FILE_SIZE_BYTES + 1)],
        contabilidad_file: [file('contabilidad.csv', 1024)],
      });
      expect(result).toEqual({ code: 'FILE_TOO_LARGE', status: 413 });
    });

    it('returns 413 when the contabilidad file exceeds 50MB', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.csv', 1024)],
        contabilidad_file: [file('contabilidad.csv', MAX_FILE_SIZE_BYTES + 1)],
      });
      expect(result).toEqual({ code: 'FILE_TOO_LARGE', status: 413 });
    });

    it('accepts a file exactly at the 50MB boundary', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.csv', MAX_FILE_SIZE_BYTES)],
        contabilidad_file: [file('contabilidad.csv', MAX_FILE_SIZE_BYTES)],
      });
      expect(result).toBeNull();
    });
  });

  describe('RF-02: extension whitelist', () => {
    it('returns 415 for a disallowed extension (e.g. .pdf)', () => {
      const result = validateUploadFiles({
        arca_file: [file('export.pdf', 1024)],
        contabilidad_file: [file('contabilidad.csv', 1024)],
      });
      expect(result).toEqual({
        code: 'INVALID_EXTENSION',
        status: 415,
        error: 'Accepted types: csv, xlsx, xls',
      });
    });

    it('accepts .csv, .xlsx and .xls (case-insensitive)', () => {
      for (const ext of ['csv', 'CSV', 'xlsx', 'XLSX', 'xls', 'Xls']) {
        const result = validateUploadFiles({
          arca_file: [file(`arca.${ext}`, 1024)],
          contabilidad_file: [file(`contabilidad.${ext}`, 1024)],
        });
        expect(result).toBeNull();
      }
    });

    it('rejects a file with no extension', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca', 1024)],
        contabilidad_file: [file('contabilidad.csv', 1024)],
      });
      expect(result?.status).toBe(415);
    });
  });

  describe('validation precedence', () => {
    it('checks missing files before size or extension', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.pdf', MAX_FILE_SIZE_BYTES + 1)],
        // contabilidad_file missing entirely
      });
      expect(result?.code).toBe('MISSING_FILES');
    });

    it('checks size before extension (a too-large .pdf is reported as 413, not 415)', () => {
      const result = validateUploadFiles({
        arca_file: [file('arca.pdf', MAX_FILE_SIZE_BYTES + 1)],
        contabilidad_file: [file('contabilidad.csv', 1024)],
      });
      expect(result?.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('T05: getAllowedExtension', () => {
    it('lowercases and strips the leading dot', () => {
      expect(getAllowedExtension('arca.CSV')).toBe('csv');
      expect(getAllowedExtension('contabilidad.Xlsx')).toBe('xlsx');
    });
  });

  describe('T05: validateTenantId', () => {
    it('accepts a well-formed UUID', () => {
      expect(validateTenantId('123e4567-e89b-12d3-a456-426614174000')).toBeNull();
    });

    it('rejects a missing tenant_id', () => {
      expect(validateTenantId(undefined)).toEqual({
        code: 'INVALID_TENANT_ID',
        status: 400,
        error: 'tenant_id is required and must be a UUID',
      });
    });

    it('rejects a non-UUID tenant_id', () => {
      const result = validateTenantId('estudio-contable-1');
      expect(result?.code).toBe('INVALID_TENANT_ID');
      expect(result?.status).toBe(400);
    });

    it('rejects a non-string tenant_id', () => {
      expect(validateTenantId(123)?.code).toBe('INVALID_TENANT_ID');
    });
  });

  describe('T10: validateContabilidadSourceSystem', () => {
    it('accepts each known source system', () => {
      for (const system of ['tango', 'bejerman', 'xubio', 'contabilium']) {
        expect(validateContabilidadSourceSystem(system)).toBeNull();
      }
    });

    it('rejects a missing value', () => {
      expect(validateContabilidadSourceSystem(undefined)?.code).toBe('INVALID_SOURCE_SYSTEM');
    });

    it('rejects an unknown source system', () => {
      expect(validateContabilidadSourceSystem('sap')?.code).toBe('INVALID_SOURCE_SYSTEM');
    });

    it('rejects "arca" (arca has a fixed adapter, not selectable here)', () => {
      expect(validateContabilidadSourceSystem('arca')?.code).toBe('INVALID_SOURCE_SYSTEM');
    });
  });
});
