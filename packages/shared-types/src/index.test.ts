import {
  AFIP_TIPOS_CADENCIAL,
  AFIP_TIPO_LABELS,
  ComprobanteTipo,
  Classification,
  CanonicalVoucher,
  VoucherRow,
  VoucherStagingRow,
  ReconciliationResult,
  TenantId,
  AfipTipo,
  isValidAfipTipo,
} from './index';

// The canonical 15 AFIP comprobante tipos (zero-padded 3-digit) per T01 spec.
const EXPECTED_TIPOS: AfipTipo[] = [
  '001', '002', '003', '004', '005',
  '006', '007', '008', '011', '014',
  '015', '021', '022', '023', '024',
];

describe('T01: shared-types AFIP tipo map + canonical voucher types', () => {
  describe('AFIP_TIPOS_CADENCIAL', () => {
    it('contains exactly the 15 canonical AFIP tipos', () => {
      expect(AFIP_TIPOS_CADENCIAL).toHaveLength(15);
      expect(AFIP_TIPOS_CADENCIAL.sort()).toEqual(EXPECTED_TIPOS.sort());
    });

    it('only contains zero-padded 3-digit codes', () => {
      const invalid = AFIP_TIPOS_CADENCIAL.filter((t) => !/^\d{3}$/.test(t));
      expect(invalid).toEqual([]);
    });
  });

  describe('isValidAfipTipo', () => {
    it('accepts all 15 canonical tipos', () => {
      EXPECTED_TIPOS.forEach((t) => {
        expect(isValidAfipTipo(t)).toBe(true);
      });
    });

    it('rejects unknown or malformed tipos (no runtime imports of unknown tipos)', () => {
      expect(isValidAfipTipo('999')).toBe(false);
      expect(isValidAfipTipo('1')).toBe(false);
      expect(isValidAfipTipo('abc')).toBe(false);
      expect(isValidAfipTipo('025')).toBe(false);
      expect(isValidAfipTipo('')).toBe(false);
    });
  });

  describe('AFIP_TIPO_LABELS', () => {
    it('has a label for every canonical tipo and only those', () => {
      const keys = Object.keys(AFIP_TIPO_LABELS);
      expect(keys.length).toBe(15);
      expect(keys.sort()).toEqual(EXPECTED_TIPOS.sort());
    });

    it('labels are non-empty strings', () => {
      Object.values(AFIP_TIPO_LABELS).forEach((label) => {
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      });
    });
  });

  describe('ComprobanteTipo', () => {
    it('exposes the same 15 tipos with human labels', () => {
      const entries = Object.keys(ComprobanteTipo);
      expect(entries.length).toBe(15);
      expect(entries.sort()).toEqual(EXPECTED_TIPOS.sort());
    });

    it('maps 001 to a Factura label', () => {
      expect(ComprobanteTipo['001'].toUpperCase()).toContain('FACTURA');
    });
  });

  describe('Classification', () => {
    it('exposes all five categories from the matching spec', () => {
      const values = Object.values(Classification).sort();
      const expected = [
        'duplicates',
        'errors',
        'matched',
        'unmatched-arca',
        'unmatched-contabilidad',
      ].sort();
      expect(values).toEqual(expected);
    });
  });

  // Compile-time contract: these type exports MUST exist and be usable.
  describe('type exports compile-time contract', () => {
    it('CanonicalVoucher is structurally usable', () => {
      const voucher: CanonicalVoucher = {
        cuit_emisor: '30123456789',
        tipo_cbte: '001',
        punto_venta: 1,
        numero: 1234,
        fecha_emision: '2021-01-01',
        importe_total_ars: 1500.0,
        iva: 270.0,
        moneda: 'ARS',
        file_source: 'arca',
        source_row: { a: 1 },
      };
      expect(voucher.cuit_emisor).toHaveLength(11);
      expect(voucher.file_source).toBe('arca');
    });

    it('TenantId is a branded string type', () => {
      const id: TenantId = '00000000-0000-0000-0000-000000000000' as TenantId;
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('VoucherRow / VoucherStagingRow / ReconciliationResult are constructible', () => {
      const row: VoucherRow = { 'Nro. Doc. Receptor': '30-12345678-9' };
      const staged: VoucherStagingRow = {
        id: 'uuid',
        tenant_id: '00000000-0000-0000-0000-000000000000' as TenantId,
        raw_data: row,
        created_at: new Date(),
      };
      const recon: ReconciliationResult = {
        id: 'uuid',
        tenant_id: staged.tenant_id,
        classification: Classification.Matched,
        arca_row: row,
        tipo_clasificacion: Classification.Matched,
        iva_impacto: 270.0,
        created_at: new Date(),
      };
      expect(staged.raw_data).toBe(row);
      expect(recon.classification).toBe('matched');
    });
  });
});
