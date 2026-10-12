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

// The real AFIP tipo integer codes ("Tabla de Comprobantes") — replaced the
// disconnected zero-padded 3-digit scheme on 2026-08-22 (conciliacion-periodica,
// RF-14): this is now the same set afip-tipo-lookup.ts's KNOWN_AFIP_CODES
// imports from here, not a separately maintained list. 15/51/81 added
// 2026-08-23 from a real client ARCA export — see AFIP_TIPOS_CADENCIAL's
// own doc comment in index.ts for why (51 in particular: RG 5762/2025
// repurposed that code away from "Factura M").
const EXPECTED_TIPOS: AfipTipo[] = [1, 2, 3, 6, 7, 8, 11, 12, 13, 15, 19, 20, 21, 51, 81];

describe('T01/T14: shared-types AFIP tipo map + canonical voucher types', () => {
  describe('AFIP_TIPOS_CADENCIAL', () => {
    it('contains exactly the real AFIP tipo codes', () => {
      expect(AFIP_TIPOS_CADENCIAL).toHaveLength(EXPECTED_TIPOS.length);
      expect([...AFIP_TIPOS_CADENCIAL].sort((a, b) => a - b)).toEqual(
        [...EXPECTED_TIPOS].sort((a, b) => a - b),
      );
    });

    it('only contains positive integers (no more zero-padded string codes)', () => {
      const invalid = AFIP_TIPOS_CADENCIAL.filter(
        (t) => !Number.isInteger(t) || t <= 0,
      );
      expect(invalid).toEqual([]);
    });
  });

  describe('isValidAfipTipo', () => {
    it('accepts all canonical tipos', () => {
      EXPECTED_TIPOS.forEach((t) => {
        expect(isValidAfipTipo(t)).toBe(true);
      });
    });

    it('rejects unknown tipo codes (no runtime imports of unknown tipos)', () => {
      expect(isValidAfipTipo(999)).toBe(false);
      expect(isValidAfipTipo(0)).toBe(false);
      expect(isValidAfipTipo(-1)).toBe(false);
      expect(isValidAfipTipo(4)).toBe(false); // not a real AFIP code
      expect(isValidAfipTipo(NaN)).toBe(false);
    });
  });

  describe('AFIP_TIPO_LABELS', () => {
    it('has a label for every canonical tipo and only those', () => {
      const keys = Object.keys(AFIP_TIPO_LABELS).map(Number);
      expect(keys.length).toBe(EXPECTED_TIPOS.length);
      expect(keys.sort((a, b) => a - b)).toEqual([...EXPECTED_TIPOS].sort((a, b) => a - b));
    });

    it('labels are non-empty strings', () => {
      Object.values(AFIP_TIPO_LABELS).forEach((label) => {
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      });
    });
  });

  describe('ComprobanteTipo', () => {
    it('exposes the same tipos with human labels', () => {
      const entries = Object.keys(ComprobanteTipo).map(Number);
      expect(entries.length).toBe(EXPECTED_TIPOS.length);
      expect(entries.sort((a, b) => a - b)).toEqual([...EXPECTED_TIPOS].sort((a, b) => a - b));
    });

    it('maps 1 to a Factura A label', () => {
      expect(ComprobanteTipo[1].toUpperCase()).toContain('FACTURA');
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
        tipo_cbte: 1,
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
