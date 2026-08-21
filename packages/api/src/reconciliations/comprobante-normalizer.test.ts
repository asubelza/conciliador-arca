import {
  excelSerialToIsoDate,
  normalizeRow,
  parseArgentineAmount,
  parseFechaEmision,
  stripCuit,
} from './comprobante-normalizer';
import { adaptRow } from './column-adapters';

/**
 * T08 — RF-07 (comprobante-normalization.spec.md). Covers every literal
 * scenario in the spec plus the RF-06 unknown-tipo integration with T07's
 * adapters.
 */
describe('T08 RF-07: stripCuit', () => {
  it('strips punctuation, keeping only digits (RF-05/RF-07 CUIT scenarios)', () => {
    expect(stripCuit('30-12345678-9')).toBe('30123456789');
    expect(stripCuit('30.12345678.9')).toBe('30123456789');
    expect(stripCuit('30123456789')).toBe('30123456789');
  });

  it('returns empty string for missing input', () => {
    expect(stripCuit(undefined)).toBe('');
  });
});

describe('T08 RF-07: parseArgentineAmount', () => {
  it('parses comma-decimal with thousands separator (RF-07 scenario: "1.500,00" -> 1500.00)', () => {
    expect(parseArgentineAmount('1.500,00')).toBe(1500);
  });

  it('parses a plain comma-decimal without thousands separator', () => {
    expect(parseArgentineAmount('500,00')).toBe(500);
  });

  it('passes a pre-parsed number straight through (xlsx numeric cells)', () => {
    expect(parseArgentineAmount(1500)).toBe(1500);
  });

  it('returns 0 for missing/empty input', () => {
    expect(parseArgentineAmount(undefined)).toBe(0);
    expect(parseArgentineAmount('')).toBe(0);
  });
});

describe('T08 RF-07: parseFechaEmision / excelSerialToIsoDate', () => {
  it('parses dd/mm/yyyy', () => {
    expect(parseFechaEmision('01/01/2021')).toBe('2021-01-01');
    expect(parseFechaEmision('5/3/2021')).toBe('2021-03-05');
  });

  it('parses an Excel date serial (RF-07 scenario: "44197" -> 2021-01-01)', () => {
    expect(parseFechaEmision('44197')).toBe('2021-01-01');
    expect(excelSerialToIsoDate(44197)).toBe('2021-01-01');
  });

  it('parses a numeric Excel serial cell directly', () => {
    expect(parseFechaEmision(44197)).toBe('2021-01-01');
  });

  it('returns empty string for missing input', () => {
    expect(parseFechaEmision(undefined)).toBe('');
  });
});

describe('T08 RF-07: normalizeRow', () => {
  it('NC carries a negative sign (RF-07 scenario: tipo 3 / NC A, "500,00" -> -500.00)', () => {
    const adapted = adaptRow('xubio', { tipo: 'NC', importe: '500,00', cuit: '30111111112' });
    const { voucher, ok } = normalizeRow('contabilidad', adapted);
    expect(ok).toBe(true);
    expect(voucher.tipo_cbte).toBe(3);
    expect(voucher.importe_total_ars).toBe(-500);
  });

  it('Factura carries a positive sign', () => {
    const adapted = adaptRow('tango', { CUIT: '30111111112', Tipo: 'Factura A', Importe: '1.500,00' });
    const { voucher, ok } = normalizeRow('contabilidad', adapted);
    expect(ok).toBe(true);
    expect(voucher.importe_total_ars).toBe(1500);
  });

  it('RF-06: unknown tipo -> ok=false, importe forced to 0', () => {
    const adapted = adaptRow('arca', {
      'Nro. Doc. Receptor': '30-12345678-9',
      'Tipo de Comprobante': '99',
      'Imp. Total': '1.500,00',
    });
    const { voucher, ok } = normalizeRow('arca', adapted);
    expect(ok).toBe(false);
    expect(voucher.importe_total_ars).toBe(0);
    expect(voucher.cuit_emisor).toBe('30123456789');
  });

  it('produces a fully canonical voucher for a complete ARCA row', () => {
    const adapted = adaptRow('arca', {
      'Nro. Doc. Receptor': '30-12345678-9',
      'Tipo de Comprobante': '1',
      'Punto de Venta': '1',
      'Número de Comprobante': '1234',
      'Fecha de Emisión': '01/01/2021',
      'Imp. Total': '1.500,00',
    });
    const { voucher, ok } = normalizeRow('arca', adapted);
    expect(ok).toBe(true);
    expect(voucher).toEqual({
      cuit_emisor: '30123456789',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 1234,
      fecha_emision: '2021-01-01',
      importe_total_ars: 1500,
      iva: 0,
      moneda: 'ARS',
      file_source: 'arca',
      source_row: adapted.source_row,
    });
  });
});
