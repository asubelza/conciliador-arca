import { lookupAfipTipo } from './afip-tipo-lookup';
import { isValidAfipTipo } from 'shared-types';

/**
 * T07 — RF-06 (comprobante-normalization.spec.md). Covers the exact
 * scenarios from the spec plus the "unknown tipo" RF-06 acceptance
 * criterion (must resolve to undefined, not throw or default silently).
 *
 * PR review finding #2 (BLOCKER): lookupAfipTipo used to resolve to a
 * made-up integer catalogue that didn't match shared-types' canonical
 * zero-padded-string `AfipTipo` codes. These expectations were updated to
 * the corrected string-based contract — see afip-tipo-lookup.ts's module
 * doc comment for the exact real-code -> canonical-code mapping chosen.
 */
describe('T07 RF-06: lookupAfipTipo', () => {
  it('ARCA: numeric tipo "1" resolves to canonical "001" (RF-05 ARCA scenario)', () => {
    expect(lookupAfipTipo('arca', '1')).toBe('001');
  });

  it('ARCA: rejects non-numeric text (ARCA is numeric-only)', () => {
    expect(lookupAfipTipo('arca', 'Factura A')).toBeUndefined();
  });

  it('Tango: "Factura A" resolves to canonical "001" (RF-05 Tango scenario)', () => {
    expect(lookupAfipTipo('tango', 'Factura A')).toBe('001');
  });

  it('Bejerman: "FCC" resolves to canonical "005" / NOTA_DE_CREDITO (RF-05 Bejerman scenario)', () => {
    expect(lookupAfipTipo('bejerman', 'FCC')).toBe('005');
  });

  it('Xubio: "NC" resolves to canonical "005" / NOTA_DE_CREDITO (RF-05 Xubio scenario)', () => {
    expect(lookupAfipTipo('xubio', 'NC')).toBe('005');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(lookupAfipTipo('tango', '  factura a  ')).toBe('001');
    expect(lookupAfipTipo('bejerman', 'fcc')).toBe('005');
  });

  it('accepts a raw numeric AFIP code from a contabilidad source too', () => {
    // "11" is the real-world Factura C code -> canonical "004".
    expect(lookupAfipTipo('tango', '11')).toBe('004');
  });

  it('RF-06: unknown tipo code resolves to undefined, not a crash or silent default', () => {
    expect(lookupAfipTipo('arca', '99')).toBeUndefined();
    expect(lookupAfipTipo('tango', 'Comprobante Inventado')).toBeUndefined();
  });

  it('RF-06: tipo drift — a new AFIP code not yet in the catalogue resolves to undefined', () => {
    // Simulates ARCA emitting a real-world code this catalogue doesn't
    // know yet; using an intentionally out-of-catalogue number to prove
    // the "unknown" path, since 20 (ND E) already IS known here.
    expect(lookupAfipTipo('arca', '77')).toBeUndefined();
  });

  it('returns undefined for null/undefined/empty input', () => {
    expect(lookupAfipTipo('tango', undefined)).toBeUndefined();
    expect(lookupAfipTipo('tango', null)).toBeUndefined();
    expect(lookupAfipTipo('tango', '')).toBeUndefined();
    expect(lookupAfipTipo('tango', '   ')).toBeUndefined();
  });

  it('every resolvable code is a valid canonical AfipTipo per shared-types', () => {
    const resolved = [
      lookupAfipTipo('arca', '1'),
      lookupAfipTipo('arca', '19'),
      lookupAfipTipo('tango', 'nd a'),
      lookupAfipTipo('tango', 'nc c'),
      lookupAfipTipo('xubio', 'nc'),
    ];
    resolved.forEach((code) => {
      expect(code).toBeDefined();
      expect(isValidAfipTipo(code as string)).toBe(true);
    });
  });
});
