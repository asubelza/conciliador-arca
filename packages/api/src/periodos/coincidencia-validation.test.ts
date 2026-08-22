import { validateCoincidenciaRequest } from './coincidencia-validation';

const SISTEMA_ID = '123e4567-e89b-12d3-a456-426614174000';
const ARCA_ID = '123e4567-e89b-12d3-a456-426614174001';

describe('RF-04: validateCoincidenciaRequest', () => {
  it('accepts a well-formed confirmar body', () => {
    const result = validateCoincidenciaRequest({
      sistema_voucher_id: SISTEMA_ID,
      arca_voucher_id: ARCA_ID,
      accion: 'confirmar',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed descartar body', () => {
    const result = validateCoincidenciaRequest({
      sistema_voucher_id: SISTEMA_ID,
      arca_voucher_id: ARCA_ID,
      accion: 'descartar',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing/malformed sistema_voucher_id', () => {
    const result = validateCoincidenciaRequest({ arca_voucher_id: ARCA_ID, accion: 'confirmar' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.code).toBe('INVALID_SISTEMA_VOUCHER_ID');

    const result2 = validateCoincidenciaRequest({ sistema_voucher_id: 'nope', arca_voucher_id: ARCA_ID, accion: 'confirmar' });
    expect(!result2.ok && result2.failure.code).toBe('INVALID_SISTEMA_VOUCHER_ID');
  });

  it('rejects a missing/malformed arca_voucher_id', () => {
    const result = validateCoincidenciaRequest({ sistema_voucher_id: SISTEMA_ID, accion: 'confirmar' });
    expect(!result.ok && result.failure.code).toBe('INVALID_ARCA_VOUCHER_ID');
  });

  it('rejects a missing/invalid accion', () => {
    const result = validateCoincidenciaRequest({ sistema_voucher_id: SISTEMA_ID, arca_voucher_id: ARCA_ID });
    expect(!result.ok && result.failure.code).toBe('INVALID_ACCION');

    const result2 = validateCoincidenciaRequest({
      sistema_voucher_id: SISTEMA_ID,
      arca_voucher_id: ARCA_ID,
      accion: 'aceptar',
    });
    expect(!result2.ok && result2.failure.code).toBe('INVALID_ACCION');
  });

  it('handles a non-object body', () => {
    const result = validateCoincidenciaRequest(null);
    expect(result.ok).toBe(false);
  });
});
