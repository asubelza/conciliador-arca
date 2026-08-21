import { lookupAfipTipo } from './afip-tipo-lookup';

/**
 * T07 — RF-06 (comprobante-normalization.spec.md). Covers the exact
 * scenarios from the spec plus the "unknown tipo" RF-06 acceptance
 * criterion (must resolve to undefined, not throw or default silently).
 */
describe('T07 RF-06: lookupAfipTipo', () => {
  it('ARCA: numeric tipo "1" resolves to canonical 1 (RF-05 ARCA scenario)', () => {
    expect(lookupAfipTipo('arca', '1')).toBe(1);
  });

  it('ARCA: rejects non-numeric text (ARCA is numeric-only)', () => {
    expect(lookupAfipTipo('arca', 'Factura A')).toBeUndefined();
  });

  it('Tango: "Factura A" resolves to canonical 1 (RF-05 Tango scenario)', () => {
    expect(lookupAfipTipo('tango', 'Factura A')).toBe(1);
  });

  it('Bejerman: "FCC" resolves to canonical 3 (RF-05 Bejerman scenario)', () => {
    expect(lookupAfipTipo('bejerman', 'FCC')).toBe(3);
  });

  it('Xubio: "NC" resolves to canonical 3 / NC A (RF-05 Xubio scenario)', () => {
    expect(lookupAfipTipo('xubio', 'NC')).toBe(3);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(lookupAfipTipo('tango', '  factura a  ')).toBe(1);
    expect(lookupAfipTipo('bejerman', 'fcc')).toBe(3);
  });

  it('accepts a raw numeric AFIP code from a contabilidad source too', () => {
    expect(lookupAfipTipo('tango', '11')).toBe(11);
  });

  it('RF-06: unknown tipo code resolves to undefined, not a crash or silent default', () => {
    expect(lookupAfipTipo('arca', '99')).toBeUndefined();
    expect(lookupAfipTipo('tango', 'Comprobante Inventado')).toBeUndefined();
  });

  it('RF-06: tipo drift — a new AFIP code not yet in the catalogue resolves to undefined', () => {
    // Simulates ARCA emitting tipo "20" if it were not already known; using
    // an intentionally out-of-catalogue number to prove the "unknown"
    // path, since 20 (ND E) already IS known here.
    expect(lookupAfipTipo('arca', '77')).toBeUndefined();
  });

  it('returns undefined for null/undefined/empty input', () => {
    expect(lookupAfipTipo('tango', undefined)).toBeUndefined();
    expect(lookupAfipTipo('tango', null)).toBeUndefined();
    expect(lookupAfipTipo('tango', '')).toBeUndefined();
    expect(lookupAfipTipo('tango', '   ')).toBeUndefined();
  });
});
