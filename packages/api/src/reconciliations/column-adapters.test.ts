import { adaptRow } from './column-adapters';

/**
 * T07 — RF-05 (comprobante-normalization.spec.md). Verifies each source's
 * column-variant adapter relocates values under the canonical field names,
 * using the spec's own scenario rows where one exists.
 */
describe('T07 RF-05: adaptRow (column-variant adapters)', () => {
  it('ARCA: maps "Nro. Doc. Emisor" + numeric tipo (RF-05 scenario, corrected 2026-08-23)', () => {
    const row = { 'Nro. Doc. Emisor': '30-12345678-9', 'Tipo de Comprobante': '1' };
    const adapted = adaptRow('arca', row);
    expect(adapted.cuit_emisor_raw).toBe('30-12345678-9');
    expect(adapted.tipo_cbte).toBe(1);
    expect(adapted.source_row).toBe(row);
  });

  it('ARCA: "Nro. Doc. Emisor" wins over "Nro. Doc. Receptor" when a row somehow carries both (Receptor is the estudio\'s own client, not the vendor)', () => {
    const row = { 'Nro. Doc. Emisor': '30500061711', 'Nro. Doc. Receptor': '33711871409', 'Tipo de Comprobante': '1' };
    const adapted = adaptRow('arca', row);
    expect(adapted.cuit_emisor_raw).toBe('30500061711');
  });

  /**
   * Real "Comprobantes Recibidos" export shape (client file, 2026-08-23):
   * `Tipo de Comprobante` carries the description ("1 - Factura A", not a
   * bare "1"), the number arrives as a Desde/Hasta pair, and — on this
   * specific export — every accented header is mojibake'd (UTF-8 bytes
   * decoded as Latin-1 somewhere upstream, baked into the file itself).
   */
  it('ARCA real export: strips the description from "N - Descripción" tipo values', () => {
    const row = { 'Nro. Doc. Emisor': '30500061711', 'Tipo de Comprobante': '11 - Factura C' };
    const adapted = adaptRow('arca', row);
    expect(adapted.tipo_cbte).toBe(11);
  });

  it('ARCA real export: a genuinely unrecognized AFIP code still resolves to undefined, not a wrong guess', () => {
    const row = { 'Nro. Doc. Emisor': '30500061711', 'Tipo de Comprobante': '999 - Código inventado' };
    const adapted = adaptRow('arca', row);
    expect(adapted.tipo_cbte).toBeUndefined();
  });

  it('ARCA real export: resolves the 3 codes added 2026-08-23 from a real client file — 15 (Recibo C), 51 (Factura A con leyenda "Operación Sujeta a Retención", RG 5762/2025 — not "Factura M"), and 81 (Tique-Factura A)', () => {
    expect(adaptRow('arca', { 'Nro. Doc. Emisor': '30500061711', 'Tipo de Comprobante': '15 - Recibo C' }).tipo_cbte).toBe(15);
    expect(
      adaptRow('arca', { 'Nro. Doc. Emisor': '30500061711', 'Tipo de Comprobante': '51 - Factura A con leyenda Operación Sujeta a Retención' })
        .tipo_cbte,
    ).toBe(51);
    expect(adaptRow('arca', { 'Nro. Doc. Emisor': '30500061711', 'Tipo de Comprobante': '81 - Tique Factura A' }).tipo_cbte).toBe(81);
  });

  it('ARCA real export: reads "Número Desde" when there is no plain "Número" column', () => {
    const row = { 'Nro. Doc. Emisor': '30500061711', 'Tipo de Comprobante': '1', 'Número Desde': 482088, 'Número Hasta': 482088 };
    const adapted = adaptRow('arca', row);
    expect(adapted.numero_raw).toBe('482088');
  });

  it('ARCA real export: repairs mojibake\'d headers (UTF-8 decoded as Latin-1 upstream of us) so accented column names still match', () => {
    // Literal mojibake bytes, same as the real file: "Fecha de EmisiÃ³n" /
    // "NÃºmero Desde" — i.e. what "Fecha de Emisión"/"Número Desde" become
    // when UTF-8 bytes get misread as Latin-1.
    const row = {
      'Nro. Doc. Emisor': '30500061711',
      'Tipo de Comprobante': '1',
      'Fecha de EmisiÃ³n': '01/04/2026',
      'NÃºmero Desde': 482088,
    };
    const adapted = adaptRow('arca', row);
    expect(adapted.fecha_emision_raw).toBe('01/04/2026');
    expect(adapted.numero_raw).toBe('482088');
  });

  it('ARCA: a bare numeric tipo (no description) still resolves exactly as before — the description-stripping is additive, not a behavior change for clean exports', () => {
    const row = { 'Nro. Doc. Emisor': '30-12345678-9', 'Tipo de Comprobante': '19' };
    const adapted = adaptRow('arca', row);
    expect(adapted.tipo_cbte).toBe(19);
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

  it('Libro de IVA Compras: resolves tipo from __prefix + __letra, uses the second date, and reads Impuestos Total (real sample shape)', () => {
    const row = {
      CUIT: '30-71590222-9',
      'Fecha Cpbte': '11/12/2025',
      Fecha: '01/04/2026',
      __prefix: 'FCP',
      __letra: 'A',
      __punto_venta: '1',
      __numero: '320',
      'Impuestos Total': '15.125.000,00',
    };
    const adapted = adaptRow('libro_iva_compras', row);
    expect(adapted.cuit_emisor_raw).toBe('30-71590222-9');
    expect(adapted.tipo_cbte).toBe(1); // FCP + A -> Factura A
    expect(adapted.punto_venta_raw).toBe('1');
    expect(adapted.numero_raw).toBe('320');
    // The comprobante's own date (Fecha Cpbte), not the accounting/booking date (Fecha).
    expect(adapted.fecha_emision_raw).toBe('11/12/2025');
    expect(adapted.importe_total_raw).toBe('15.125.000,00');
  });

  it('Libro de IVA Compras: a "CCP" prefix resolves to the Nota de Crédito tipo, not Factura', () => {
    const row = { __prefix: 'CCP', __letra: 'C' };
    const adapted = adaptRow('libro_iva_compras', row);
    expect(adapted.tipo_cbte).toBe(13); // CCP + C -> NC C, not 11 (Factura C)
  });

  it('Libro de IVA Compras: tipo_cbte is undefined when there is no comprobante prefix/letra (e.g. a bank-debit row)', () => {
    const adapted = adaptRow('libro_iva_compras', { CUIT: '30-99903208-3' });
    expect(adapted.tipo_cbte).toBeUndefined();
  });
});
