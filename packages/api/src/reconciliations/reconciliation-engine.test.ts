import { buildCompositeKey, dedupeBySide, matchVouchers } from './reconciliation-engine';
import type { CanonicalVoucher } from 'shared-types';

/**
 * T09 — RF-08 (reconciliation-matching.spec.md).
 */
function voucher(overrides: Partial<CanonicalVoucher> = {}): CanonicalVoucher {
  return {
    cuit_emisor: '30123456789',
    tipo_cbte: '001',
    punto_venta: 1,
    numero: 1,
    fecha_emision: '2021-01-01',
    importe_total_ars: 100,
    iva: 21,
    moneda: 'ARS',
    file_source: 'arca',
    source_row: {},
    ...overrides,
  };
}

describe('T09 RF-08: buildCompositeKey', () => {
  it('joins cuit_emisor|tipo_cbte|punto_venta|numero', () => {
    expect(
      buildCompositeKey(voucher({ cuit_emisor: '30123456789', tipo_cbte: '001', punto_venta: 1, numero: 1234 })),
    ).toBe('30123456789|001|1|1234');
  });
});

describe('T09 RF-08: dedupeBySide (same-side dedupe)', () => {
  it('keeps only the first occurrence of a duplicate composite key (RF-08 scenario)', () => {
    const a = voucher({ numero: 1234 });
    const b = voucher({ numero: 1234 }); // same key, duplicate
    const c = voucher({ numero: 5678 });

    const { unique, duplicates } = dedupeBySide([a, b, c]);
    expect(unique).toEqual([a, c]);
    expect(duplicates).toEqual([b]);
  });

  it('reports no duplicates when all keys are unique', () => {
    const vouchers = [voucher({ numero: 1 }), voucher({ numero: 2 }), voucher({ numero: 3 })];
    const { unique, duplicates } = dedupeBySide(vouchers);
    expect(unique).toHaveLength(3);
    expect(duplicates).toHaveLength(0);
  });
});

describe('T09 RF-08: matchVouchers', () => {
  it('classifies a matched pair by identical composite key', () => {
    const arcaV = voucher({ numero: 1234, file_source: 'arca' });
    const contV = voucher({ numero: 1234, file_source: 'contabilidad', importe_total_ars: 99 });
    const { matched, unmatchedArca, unmatchedContabilidad } = matchVouchers([arcaV], [contV]);
    expect(matched).toEqual([{ arca: arcaV, contabilidad: contV }]);
    expect(unmatchedArca).toHaveLength(0);
    expect(unmatchedContabilidad).toHaveLength(0);
  });

  it('classifies an ARCA-only voucher as unmatchedArca', () => {
    const arcaOnly = voucher({ numero: 999 });
    const { matched, unmatchedArca, unmatchedContabilidad } = matchVouchers([arcaOnly], []);
    expect(matched).toHaveLength(0);
    expect(unmatchedArca).toEqual([arcaOnly]);
    expect(unmatchedContabilidad).toHaveLength(0);
  });

  it('classifies a contabilidad-only voucher as unmatchedContabilidad', () => {
    const contOnly = voucher({ numero: 999, file_source: 'contabilidad' });
    const { matched, unmatchedArca, unmatchedContabilidad } = matchVouchers([], [contOnly]);
    expect(matched).toHaveLength(0);
    expect(unmatchedContabilidad).toEqual([contOnly]);
    expect(unmatchedArca).toHaveLength(0);
  });

  it('RF-08: 1,000 ARCA + 950 contabilidad, 900 overlaps -> 900 matched, exactly 1,000 probes, < 500ms', () => {
    const arca: CanonicalVoucher[] = [];
    const contabilidad: CanonicalVoucher[] = [];
    for (let i = 0; i < 1000; i++) arca.push(voucher({ numero: i }));
    // 900 overlapping keys (0..899) + 50 contabilidad-only keys (1000..1049)
    for (let i = 0; i < 900; i++) contabilidad.push(voucher({ numero: i, file_source: 'contabilidad' }));
    for (let i = 1000; i < 1050; i++) contabilidad.push(voucher({ numero: i, file_source: 'contabilidad' }));

    const start = performance.now();
    const result = matchVouchers(arca, contabilidad);
    const elapsedMs = performance.now() - start;

    expect(result.matched).toHaveLength(900);
    expect(result.unmatchedArca).toHaveLength(100); // arca 900..999
    expect(result.unmatchedContabilidad).toHaveLength(50);
    // larger side is arca (1000 items) -> exactly 1000 probes, per spec.
    expect(result.probeCount).toBe(1000);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('RF-08: tenant isolation — running the engine per tenant never lets tenant B leak into tenant A results', () => {
    // CanonicalVoucher has no tenant_id field by design (see module doc);
    // isolation is structural: each tenant's arrays are matched in a
    // separate call. This test proves a same-key collision across two
    // tenants' *separately supplied* arrays cannot cross-contaminate.
    const tenantAArca = [voucher({ cuit_emisor: '30111111111', numero: 1 })];
    const tenantAContabilidad = [voucher({ cuit_emisor: '30111111111', numero: 1, file_source: 'contabilidad' })];
    const tenantBArca = [voucher({ cuit_emisor: '30111111111', numero: 1, importe_total_ars: 555 })];
    const tenantBContabilidad: CanonicalVoucher[] = []; // tenant B has no contabilidad counterpart

    const resultA = matchVouchers(tenantAArca, tenantAContabilidad);
    const resultB = matchVouchers(tenantBArca, tenantBContabilidad);

    expect(resultA.matched).toHaveLength(1);
    expect(resultB.matched).toHaveLength(0);
    expect(resultB.unmatchedArca).toEqual(tenantBArca);
    // Tenant A's result must not contain tenant B's voucher object.
    expect(resultA.matched[0].arca).not.toBe(tenantBArca[0]);
  });
});
