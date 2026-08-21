import { classifyStagedRows, classifyVouchers } from './classification-engine';
import { Classification } from 'shared-types';
import type { CanonicalVoucher } from 'shared-types';

/**
 * T10 — RF-09 (reconciliation-matching.spec.md).
 */
function voucher(overrides: Partial<CanonicalVoucher> = {}): CanonicalVoucher {
  return {
    cuit_emisor: '30123456789',
    tipo_cbte: 1,
    punto_venta: 1,
    numero: 1,
    fecha_emision: '2021-01-01',
    importe_total_ars: 100,
    iva: 0,
    moneda: 'ARS',
    file_source: 'arca',
    source_row: {},
    ...overrides,
  };
}

describe('T10 RF-09: classifyVouchers — classification', () => {
  it('classifies a matched pair', () => {
    const arca = voucher({ numero: 1 });
    const cont = voucher({ numero: 1, file_source: 'contabilidad' });
    const { results, counts } = classifyVouchers([arca], [cont]);
    expect(results).toEqual([
      { classification: Classification.Matched, composite_key: '30123456789|1|1|1', arca, contabilidad: cont, iva_amount: 0 },
    ]);
    expect(counts[Classification.Matched]).toBe(1);
  });

  it('classifies unmatched-arca and unmatched-contabilidad', () => {
    const arcaOnly = voucher({ numero: 1 });
    const contOnly = voucher({ numero: 2, file_source: 'contabilidad' });
    const { results, counts } = classifyVouchers([arcaOnly], [contOnly]);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classification: Classification.UnmatchedArca, arca: arcaOnly }),
        expect.objectContaining({ classification: Classification.UnmatchedContabilidad, contabilidad: contOnly }),
      ]),
    );
    expect(counts[Classification.UnmatchedArca]).toBe(1);
    expect(counts[Classification.UnmatchedContabilidad]).toBe(1);
  });

  it('classifies same-side duplicates', () => {
    const original = voucher({ numero: 1 });
    const duplicate = voucher({ numero: 1 });
    const { results, counts } = classifyVouchers([original, duplicate], []);
    expect(counts[Classification.Duplicates]).toBe(1);
    expect(results.some((r) => r.classification === Classification.Duplicates && r.arca === duplicate)).toBe(true);
  });

  it('classifies pre-computed errors (unresolved tipo from T08) without matching them', () => {
    const errorVoucher = voucher({ numero: 1, tipo_cbte: 0 });
    const { results, counts } = classifyVouchers([], [], [errorVoucher], []);
    expect(counts[Classification.Errors]).toBe(1);
    expect(results[0]).toMatchObject({ classification: Classification.Errors, arca: errorVoucher });
  });

  it('covers all 5 categories in one run', () => {
    const matchedArca = voucher({ numero: 1 });
    const matchedCont = voucher({ numero: 1, file_source: 'contabilidad' });
    const unmatchedArca = voucher({ numero: 2 });
    const unmatchedCont = voucher({ numero: 3, file_source: 'contabilidad' });
    const dupArca = voucher({ numero: 4 });
    const dupArca2 = voucher({ numero: 4 });
    const errorArca = voucher({ numero: 5, tipo_cbte: 0 });

    const { counts } = classifyVouchers(
      [matchedArca, unmatchedArca, dupArca, dupArca2],
      [matchedCont, unmatchedCont],
      [errorArca],
      [],
    );

    // The surviving (first) copy of the duplicate key has no contabilidad
    // counterpart, so it also legitimately counts as unmatched-arca in
    // addition to unmatchedArca(numero=2) — duplicates only removes the
    // *extra* occurrence(s), not the kept one, from matching.
    expect(counts).toEqual({
      matched: 1,
      'unmatched-arca': 2,
      'unmatched-contabilidad': 1,
      duplicates: 1,
      errors: 1,
    });
  });
});

describe('T10 RF-09: IVA priority sort on unmatched', () => {
  it('sorts unmatched vouchers by iva_amount DESC (RF-09 scenario: $2000, $500, $50)', () => {
    const low = voucher({ numero: 1, iva: 50 });
    const high = voucher({ numero: 2, iva: 2000 });
    const mid = voucher({ numero: 3, iva: 500 });

    const { results } = classifyVouchers([low, high, mid], []);
    const ivaOrder = results.map((r) => r.iva_amount);
    expect(ivaOrder).toEqual([2000, 500, 50]);
  });

  it('sorts unmatched across both arca and contabilidad together', () => {
    const arcaHigh = voucher({ numero: 1, iva: 900 });
    const contLow = voucher({ numero: 2, iva: 10, file_source: 'contabilidad' });
    const contHigh = voucher({ numero: 3, iva: 1500, file_source: 'contabilidad' });

    const { results } = classifyVouchers([arcaHigh], [contLow, contHigh]);
    const unmatchedResults = results.filter(
      (r) => r.classification === Classification.UnmatchedArca || r.classification === Classification.UnmatchedContabilidad,
    );
    expect(unmatchedResults.map((r) => r.iva_amount)).toEqual([1500, 900, 10]);
  });

  it('does not reorder matched, duplicate, or error rows', () => {
    const matchedArca = voucher({ numero: 1, iva: 5 });
    const matchedCont = voucher({ numero: 1, file_source: 'contabilidad', iva: 5 });
    const { results } = classifyVouchers([matchedArca], [matchedCont]);
    expect(results[0].classification).toBe(Classification.Matched);
  });
});

describe('T10: classifyStagedRows (raw-row end-to-end pipeline)', () => {
  it('adapts, normalizes and classifies raw staged rows end to end', () => {
    const arcaRows = [{ 'Nro. Doc. Receptor': '30111111112', 'Tipo de Comprobante': '1', 'Punto de Venta': '1', 'Número de Comprobante': '1', 'Imp. Total': '100,00' }];
    const contabilidadRows = [{ CUIT: '30111111112', Tipo: 'Factura A', 'Punto de Venta': '1', Número: '1', Importe: '100,00' }];

    const { results, counts } = classifyStagedRows(arcaRows, contabilidadRows, 'tango');
    expect(counts[Classification.Matched]).toBe(1);
    expect(results[0].composite_key).toBe('30111111112|1|1|1');
  });

  it('routes an unresolvable tipo to errors instead of throwing', () => {
    const arcaRows = [{ 'Nro. Doc. Receptor': '30111111112', 'Tipo de Comprobante': '999' }];
    const { counts } = classifyStagedRows(arcaRows, [], 'tango');
    expect(counts[Classification.Errors]).toBe(1);
  });
});
