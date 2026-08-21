import { adaptRow } from './column-adapters';

/**
 * T07 — RF-05 (comprobante-normalization.spec.md). Verifies each source's
 * column-variant adapter relocates values under the canonical field names,
 * using the spec's own scenario rows where one exists.
 */
describe('T07 RF-05: adaptRow (column-variant adapters)', () => {
  it('ARCA: maps "Nro. Doc. Receptor" + numeric tipo (RF-05 scenario)', () => {
    const row = { 'Nro. Doc. Receptor': '30-12345678-9', 'Tipo de Comprobante': '1' };
    const adapted = adaptRow('arca', row);
    expect(adapted.cuit_emisor_raw).toBe('30-12345678-9');
    expect(adapted.tipo_cbte).toBe(1);
    expect(adapted.source_row).toBe(row);
  });

  it('Tango: maps "CUIT" + "Tipo" text label (RF-05 scenario)', () => {
    const row = { CUIT: '30.12345678.9', Tipo: 'Factura A' };
    const adapted = adaptRow('tango', row);
    expect(adapted.cuit_emisor_raw).toBe('30.12345678.9');
    expect(adapted.tipo_cbte).toBe(1);
  });

  it('Bejerman: maps "S/Tc" + splits "Nro.Comp." into punto_venta/numero (RF-05 scenario)', () => {
    const row = { 'S/Tc': 'FCC', 'Nro.Comp.': '0001-00001234' };
    const adapted = adaptRow('bejerman', row);
    expect(adapted.tipo_cbte).toBe(3);
    expect(adapted.punto_venta_raw).toBe('1');
    expect(adapted.numero_raw).toBe('1234');
  });

  it('Xubio: maps "tipo" + "importe" (RF-05 scenario)', () => {
    const row = { tipo: 'NC', importe: '1.500,00' };
    const adapted = adaptRow('xubio', row);
    expect(adapted.tipo_cbte).toBe(3);
    expect(adapted.importe_total_raw).toBe('1.500,00');
  });

  it('Contabilium: maps full-word columns (no RF-05 scenario yet, self-consistency check)', () => {
    const row = { CUIT: '30111111112', 'Tipo Comprobante': 'Factura B', Total: '2.000,00' };
    const adapted = adaptRow('contabilium', row);
    expect(adapted.cuit_emisor_raw).toBe('30111111112');
    expect(adapted.tipo_cbte).toBe(6);
    expect(adapted.importe_total_raw).toBe('2.000,00');
  });

  it('leaves fields undefined (not throwing) when a column is absent', () => {
    const adapted = adaptRow('tango', {});
    expect(adapted.cuit_emisor_raw).toBeUndefined();
    expect(adapted.tipo_cbte).toBeUndefined();
    expect(adapted.importe_total_raw).toBeUndefined();
  });
});
