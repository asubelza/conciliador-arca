/**
 * coincidencia-validation.ts — RF-04 follow-up: request-shape validation for
 * `POST /api/periodos/:id/coincidencias` (contador confirma o descarta una
 * sugerencia de coincidencia por similitud). Same dependency-free style as
 * periodos-validation.ts / marks-validation.ts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COINCIDENCIA_ACCIONES = ['confirmar', 'descartar'] as const;
export type CoincidenciaAccion = (typeof COINCIDENCIA_ACCIONES)[number];

export interface CoincidenciaRequestBody {
  sistema_voucher_id: string;
  arca_voucher_id: string;
  accion: CoincidenciaAccion;
}

export type CoincidenciaValidationFailure =
  | { code: 'INVALID_SISTEMA_VOUCHER_ID'; status: 400; error: string }
  | { code: 'INVALID_ARCA_VOUCHER_ID'; status: 400; error: string }
  | { code: 'INVALID_ACCION'; status: 400; error: string };

export type CoincidenciaValidationResult =
  | { ok: true; value: CoincidenciaRequestBody }
  | { ok: false; failure: CoincidenciaValidationFailure };

export function validateCoincidenciaRequest(body: unknown): CoincidenciaValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.sistema_voucher_id !== 'string' || !UUID_RE.test(b.sistema_voucher_id)) {
    return {
      ok: false,
      failure: { code: 'INVALID_SISTEMA_VOUCHER_ID', status: 400, error: 'sistema_voucher_id must be a UUID' },
    };
  }

  if (typeof b.arca_voucher_id !== 'string' || !UUID_RE.test(b.arca_voucher_id)) {
    return {
      ok: false,
      failure: { code: 'INVALID_ARCA_VOUCHER_ID', status: 400, error: 'arca_voucher_id must be a UUID' },
    };
  }

  if (typeof b.accion !== 'string' || !(COINCIDENCIA_ACCIONES as readonly string[]).includes(b.accion)) {
    return {
      ok: false,
      failure: {
        code: 'INVALID_ACCION',
        status: 400,
        error: `accion is required and must be one of: ${COINCIDENCIA_ACCIONES.join(', ')}`,
      },
    };
  }

  return {
    ok: true,
    value: {
      sistema_voucher_id: b.sistema_voucher_id,
      arca_voucher_id: b.arca_voucher_id,
      accion: b.accion as CoincidenciaAccion,
    },
  };
}
