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

  describe('PR review finding #5: dot-only thousands separator (no comma)', () => {
    it('treats a lone dot as a thousands separator, not a decimal point ("1.500" -> 1500)', () => {
      expect(parseArgentineAmount('1.500')).toBe(1500);
    });

    it('handles multiple thousands-grouping dots ("1.234.567" -> 1234567)', () => {
      expect(parseArgentineAmount('1.234.567')).toBe(1234567);
    });

    it('parses a plain integer with no separators unchanged ("1500" -> 1500)', () => {
      expect(parseArgentineAmount('1500')).toBe(1500);
    });

    it('parses a comma-decimal with no thousands grouping ("0,50" -> 0.5)', () => {
      expect(parseArgentineAmount('0,50')).toBe(0.5);
    });
  });

  describe('verification follow-up: a dot with fewer than 3 trailing digits is not valid Argentine grouping', () => {
    it('parses a lone-dot value with 1 trailing digit as a decimal, not thousands ("1.5" -> 1.5)', () => {
      expect(parseArgentineAmount('1.5')).toBe(1.5);
    });

    it('parses a lone-dot value with 2 trailing digits as a decimal, not thousands ("100.50" -> 100.5)', () => {
      expect(parseArgentineAmount('100.50')).toBe(100.5);
    });

    it('still strips a valid 3-digit thousands group even with a leading 1-2 digit group ("12.500" -> 12500)', () => {
      expect(parseArgentineAmount('12.500')).toBe(12500);
    });
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
  it('NC carries a negative sign (RF-07 scenario: tipo "005" / NOTA_DE_CREDITO, "500,00" -> -500.00)', () => {
    const adapted = adaptRow('xubio', { tipo: 'NC', importe: '500,00', cuit: '30111111112' });
    const { voucher, ok } = normalizeRow('contabilidad', adapted);
    expect(ok).toBe(true);
    expect(voucher.tipo_cbte).toBe('005');
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
      tipo_cbte: '001',
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

  describe('PR review finding #7: edge-case coverage', () => {
    it('an empty row object {} through adaptRow -> normalizeRow does not throw, and resolves to ok=false', () => {
      const adapted = adaptRow('tango', {});
      const { voucher, ok } = normalizeRow('contabilidad', adapted);
      expect(ok).toBe(false);
      expect(voucher).toEqual({
        cuit_emisor: '',
        tipo_cbte: '',
        punto_venta: 0,
        numero: 0,
        fecha_emision: '',
        importe_total_ars: 0,
        iva: 0,
        moneda: 'ARS',
        file_source: 'contabilidad',
        source_row: {},
      });
    });

    it('non-numeric punto_venta/numero is flagged (ok=false), not silently coerced to 0', () => {
      const adapted = adaptRow('tango', {
        CUIT: '30111111112',
        Tipo: 'Factura A',
        'Punto de Venta': 'ABC',
        'Número': '1234',
        Importe: '1.500,00',
      });
      const { voucher, ok } = normalizeRow('contabilidad', adapted);
      expect(ok).toBe(false);
      // Garbage input still renders as 0 in the voucher (same as the
      // unknown-tipo path), but `ok: false` is how a caller distinguishes
      // this from a legitimately-zero punto_venta.
      expect(voucher.punto_venta).toBe(0);
      expect(voucher.importe_total_ars).toBe(0);
    });

    it('a legitimately-zero punto_venta/numero is NOT flagged as an error', () => {
      const adapted = adaptRow('tango', {
        CUIT: '30111111112',
        Tipo: 'Factura A',
        'Punto de Venta': '0',
        'Número': '0',
        Importe: '1.500,00',
      });
      const { voucher, ok } = normalizeRow('contabilidad', adapted);
      expect(ok).toBe(true);
      expect(voucher.punto_venta).toBe(0);
      expect(voucher.numero).toBe(0);
      expect(voucher.importe_total_ars).toBe(1500);
    });
  });
});
