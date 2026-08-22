/**
 * libro-iva-compras-parser.test.ts — real-world gap found 2026-08-21 (see
 * the module doc). All non-trivial fixtures below are copied verbatim from
 * the user's actual `PLATAFORMA_COMPRAS.xlsx` (a real "Libro de IVA
 * Compras" export), not synthesized, per this project's established
 * discipline of testing against real sample data wherever it exists.
 */
import { parseLibroIvaComprasLines } from './libro-iva-compras-parser';

const COMPANY_NAME_LINE =
  '         GRUPO ARIES SALUD SA                                                                                                                                                                                                                                                                Página:             1';
const ADDRESS_LINE = '         Acoyte 213 CABA - C.A.B.A';
const TITLE_LINE =
  '                                                                                                                                                    Libro de IVA Compras';
const SOFTWARE_LINE_A = '         SIS2010b';
const SOFTWARE_LINE_B = '         SIS2000b';
const LIBRO_LINE = '         Libro de IVA: COM, COMPRAS';
const DIVISION_LINE = '         Division: 1                                                                               Fecha:  01/04/2026    al30/04/2026';
const HEADER_LINE_1 =
  '         Fecha       Comprobante                       Fecha       Sujeto                                CUIT           Con.   Referencia  Impuestos      Total          Neto             Exento          Neto            21%         10.5%          27%      Per. IIBB       Per. IVA                      Otros';
const HEADER_LINE_2 =
  '                                                       Cpbte                                                            IVA                             cmpbte        no gravado                        gravado                                                                                        conceptos';
const PAGE_BREAK_LINE = '_x000C_';
const TOTAL_LINE =
  '         Total                                                                                                                                    242.479.278,08    194.624.087,01               0,00    39.453.079,498.230.023,45  10.920,00     42.792,73        35.592,70     82.625,34                   157,36';

// Real data row (Factura A) — includes the confirmed run-together-numbers
// case: "12.500.000,002.625.000,00" is Neto gravado (12.500.000,00)
// immediately followed by 21% (2.625.000,00), with zero separating
// whitespace, because both amounts are wide enough to fill their columns.
const ROW_FACTURA_A =
  '         01/04/2026   0001-FCP-A-0001-00000320         11/12/2025  30, GAV SALUD S.A.               30-71590222-9      RI    -0001-0000021692      15.125.000,00              0,00              0,00  12.500.000,002.625.000,00        0,00          0,00             0,00            0,00                     0,00';

// Real data row (Factura C, monotributista "Con." = MO).
const ROW_FACTURA_C =
  '         01/04/2026   0001-FCP-C-0001-00000029         30/01/2026  1937, VELOZO NATALIA ANTO        27-37554204-3      MO    -0001-0000021541         432.000,00        432.000,00              0,00           0,00        0,00        0,00          0,00             0,00            0,00                     0,00';

// Real data row — a negative "CCP" (Nota de Crédito) row.
const ROW_NC_C =
  '         09/04/2026   0001-CCP-C-0002-00000043         09/04/2026  2, Carolina Paula Caligiuri      27-30135513-6      MO    -0001-2026040008        -211.400,00       -211.400,00              0,00           0,00        0,00        0,00          0,00             0,00            0,00                     0,00';

// Real data row — a bank-debit entry with no AFIP-shaped comprobante at
// all ("0001-DBI-3004000026", no letra/puntoVenta split).
const ROW_BANK_DEBIT =
  '         30/04/2026   0001-DBI-3004000026              30/04/2026  5, BANCO CIUDAD DE BS AS         30-99903208-3      RI    -0001-2026040003          89.266,63              0,00              0,00      71.511,32   15.017,38        0,00          0,00           684,81        2.053,12                     0,00';

describe('parseLibroIvaComprasLines', () => {
  it('skips company-info, title, software-id, libro, division, header and page-break lines', () => {
    const rows = parseLibroIvaComprasLines([
      null,
      COMPANY_NAME_LINE,
      ADDRESS_LINE,
      TITLE_LINE,
      SOFTWARE_LINE_A,
      undefined,
      LIBRO_LINE,
      DIVISION_LINE,
      null,
      HEADER_LINE_1,
      HEADER_LINE_2,
      PAGE_BREAK_LINE,
      SOFTWARE_LINE_B,
    ]);
    expect(rows).toEqual([]);
  });

  it('skips the trailing grand-total summary row', () => {
    const rows = parseLibroIvaComprasLines([TOTAL_LINE]);
    expect(rows).toEqual([]);
  });

  it('parses a real Factura A row, correctly splitting the two run-together amount columns', () => {
    const [row] = parseLibroIvaComprasLines([ROW_FACTURA_A]);
    expect(row.Fecha).toBe('01/04/2026');
    expect(row.Comprobante).toBe('0001-FCP-A-0001-00000320');
    expect(row['Fecha Cpbte']).toBe('11/12/2025');
    expect(row.Sujeto).toBe('30, GAV SALUD S.A.');
    expect(row.CUIT).toBe('30-71590222-9');
    expect(row['Con.']).toBe('RI');
    expect(row.Referencia).toBe('-0001-0000021692');
    expect(row.__prefix).toBe('FCP');
    expect(row.__letra).toBe('A');
    expect(row.__punto_venta).toBe('1');
    expect(row.__numero).toBe('320');
    expect(row['Impuestos Total']).toBe('15.125.000,00');
    expect(row['Neto no gravado']).toBe('0,00');
    expect(row.Exento).toBe('0,00');
    // The two concatenated values, correctly split back apart:
    expect(row['Neto gravado']).toBe('12.500.000,00');
    expect(row['21%']).toBe('2.625.000,00');
    expect(row['10.5%']).toBe('0,00');
    expect(row['27%']).toBe('0,00');
    expect(row['Per. IIBB']).toBe('0,00');
    expect(row['Per. IVA']).toBe('0,00');
    expect(row['Otros conceptos']).toBe('0,00');
  });

  it('parses a real Factura C row (monotributista)', () => {
    const [row] = parseLibroIvaComprasLines([ROW_FACTURA_C]);
    expect(row.CUIT).toBe('27-37554204-3');
    expect(row['Con.']).toBe('MO');
    expect(row.__prefix).toBe('FCP');
    expect(row.__letra).toBe('C');
    expect(row.Sujeto).toBe('1937, VELOZO NATALIA ANTO');
    expect(row['Impuestos Total']).toBe('432.000,00');
  });

  it('parses a real negative "CCP" (Nota de Crédito) row, preserving the sign', () => {
    const [row] = parseLibroIvaComprasLines([ROW_NC_C]);
    expect(row.__prefix).toBe('CCP');
    expect(row.__letra).toBe('C');
    expect(row['Impuestos Total']).toBe('-211.400,00');
    expect(row['Neto no gravado']).toBe('-211.400,00');
  });

  it('still parses a bank-debit row with no AFIP-shaped comprobante, leaving __letra/__prefix undefined', () => {
    const [row] = parseLibroIvaComprasLines([ROW_BANK_DEBIT]);
    expect(row.Fecha).toBe('30/04/2026');
    expect(row.CUIT).toBe('30-99903208-3');
    expect(row.Comprobante).toBeUndefined();
    expect(row.__prefix).toBeUndefined();
    expect(row.__letra).toBeUndefined();
    expect(row['Impuestos Total']).toBe('89.266,63');
  });

  it('parses a full realistic multi-page mix end to end, in order, skipping every non-data line', () => {
    const lines = [
      COMPANY_NAME_LINE,
      ADDRESS_LINE,
      TITLE_LINE,
      SOFTWARE_LINE_A,
      LIBRO_LINE,
      DIVISION_LINE,
      HEADER_LINE_1,
      HEADER_LINE_2,
      ROW_FACTURA_A,
      ROW_FACTURA_C,
      PAGE_BREAK_LINE,
      COMPANY_NAME_LINE,
      ADDRESS_LINE,
      TITLE_LINE,
      SOFTWARE_LINE_B,
      HEADER_LINE_1,
      HEADER_LINE_2,
      ROW_NC_C,
      ROW_BANK_DEBIT,
      TOTAL_LINE,
    ];
    const rows = parseLibroIvaComprasLines(lines);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.CUIT)).toEqual([
      '30-71590222-9',
      '27-37554204-3',
      '27-30135513-6',
      '30-99903208-3',
    ]);
  });
});
