import ExcelJS from 'exceljs';
import {
  buildPeriodoExportSections,
  toPeriodoReportCsv,
  toPeriodoReportXlsxBuffer,
  CLASSIFICATION_LABELS,
} from './periodo-report-exporter';
import type { VoucherCanonicalRow } from '../reconciliations/periodo-matching-engine';
import type { PeriodoReportRow, PeriodoReportSections } from './periodo-report';

/**
 * Added at the client's explicit request (2026-08-22): "Si descargar en
 * csv/xlsx con diseño profesional" for the período report — this was
 * deliberately out of scope in T29 (see periodo-report.ts's module doc).
 */
function voucherRow(overrides: Partial<VoucherCanonicalRow> = {}): VoucherCanonicalRow {
  return {
    id: 'v1',
    cuit_emisor: '30111111112',
    tipo_cbte: 1,
    punto_venta: 1,
    numero: 100,
    importe_total: 1000,
    iva: 210,
    fecha: '2026-01-15',
    file_source: 'arca',
    estado: 'pendiente',
    periodo_alta_id: 'p1',
    ...overrides,
  };
}

function emptySections(): PeriodoReportSections {
  return { conciliados_ok: [], discrepancias_y_alertas: [], pendientes_en_arca: [], posibles_coincidencias: [] };
}

/** Fills in the two RF-04/RF-09 fields with their "nothing to report" defaults, so each test literal only needs to state what it's actually testing. */
function reportRow(overrides: Omit<PeriodoReportRow, 'similarity_reason' | 'feedback_previo'>): PeriodoReportRow {
  return { similarity_reason: null, feedback_previo: null, ...overrides };
}

describe('periodo-report-exporter: buildPeriodoExportSections', () => {
  it('flattens sistema/arca rows into export rows, preferring arca for the comprobante identity fields', () => {
    const row: PeriodoReportRow = reportRow({
      classification: 'conciliado_ok',
      composite_key: '30111111112|1|1|100',
      sistema: voucherRow({ file_source: 'contabilidad', importe_total: 995 }),
      arca: voucherRow({ file_source: 'arca', importe_total: 1000 }),
      divergencia_ars: null,
      antiguedad_meses: null,
    });
    const sections = emptySections();
    sections.conciliados_ok.push(row);

    const exported = buildPeriodoExportSections(sections);
    expect(exported.conciliados_ok).toHaveLength(1);
    expect(exported.conciliados_ok[0]).toMatchObject({
      classification: 'conciliado_ok',
      cuit_emisor: '30111111112',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 100,
      fecha_emision: '2026-01-15',
      importe_arca: 1000,
      importe_sistema: 995,
    });
  });

  it('sorts each section by importe descending (higher-impact rows first)', () => {
    const sections = emptySections();
    sections.pendientes_en_arca.push(
      reportRow({ classification: 'pendiente_en_arca', composite_key: 'k1', sistema: null, arca: voucherRow({ importe_total: 100 }), divergencia_ars: null, antiguedad_meses: 1 }),
      reportRow({ classification: 'pendiente_en_arca', composite_key: 'k2', sistema: null, arca: voucherRow({ importe_total: 5000 }), divergencia_ars: null, antiguedad_meses: 2 }),
      reportRow({ classification: 'pendiente_en_arca', composite_key: 'k3', sistema: null, arca: voucherRow({ importe_total: 900 }), divergencia_ars: null, antiguedad_meses: 3 }),
    );

    const exported = buildPeriodoExportSections(sections);
    expect(exported.pendientes_en_arca.map((r) => r.importe_arca)).toEqual([5000, 900, 100]);
  });

  it('a sistema-only row (no_existe_en_arca) has null importe_arca, and identity fields come from sistema', () => {
    const sections = emptySections();
    sections.discrepancias_y_alertas.push(reportRow({
      classification: 'no_existe_en_arca',
      composite_key: 'k1',
      sistema: voucherRow({ file_source: 'contabilidad', cuit_emisor: '30222222223', importe_total: 300 }),
      arca: null,
      divergencia_ars: null,
      antiguedad_meses: null,
    }));

    const exported = buildPeriodoExportSections(sections);
    expect(exported.discrepancias_y_alertas[0]).toMatchObject({
      cuit_emisor: '30222222223',
      importe_arca: null,
      importe_sistema: 300,
    });
  });
});

describe('periodo-report-exporter: toPeriodoReportCsv', () => {
  it('renders a "seccion" column and money fields with 2 decimals', () => {
    const sections = buildPeriodoExportSections({
      conciliados_ok: [
        reportRow({
          classification: 'conciliado_ok',
          composite_key: 'k1',
          sistema: voucherRow({ file_source: 'contabilidad', importe_total: 999.5 }),
          arca: voucherRow({ file_source: 'arca', importe_total: 1000 }),
          divergencia_ars: null,
          antiguedad_meses: null,
        }),
      ],
      discrepancias_y_alertas: [],
      pendientes_en_arca: [],
      posibles_coincidencias: [],
    });

    const csv = toPeriodoReportCsv(sections);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'seccion,clasificacion,cuit_emisor,tipo_cbte,punto_venta,numero,fecha_emision,importe_arca,importe_sistema,divergencia_ars,antiguedad_meses',
    );
    expect(lines[1]).toBe('Conciliados OK,Conciliado OK,30111111112,1,1,100,2026-01-15,1000.00,999.50,,');
  });

  it('renders an empty CSV (header only) for a período with no rows', () => {
    const csv = toPeriodoReportCsv(buildPeriodoExportSections(emptySections()));
    expect(csv.trim()).toBe(
      'seccion,clasificacion,cuit_emisor,tipo_cbte,punto_venta,numero,fecha_emision,importe_arca,importe_sistema,divergencia_ars,antiguedad_meses',
    );
  });
});

describe('periodo-report-exporter: toPeriodoReportXlsxBuffer', () => {
  it('produces a valid workbook with one styled sheet per section, correct title and header row', async () => {
    const sections = buildPeriodoExportSections({
      conciliados_ok: [
        reportRow({
          classification: 'conciliado_ok',
          composite_key: 'k1',
          sistema: voucherRow({ file_source: 'contabilidad' }),
          arca: voucherRow({ file_source: 'arca' }),
          divergencia_ars: null,
          antiguedad_meses: null,
        }),
      ],
      discrepancias_y_alertas: [],
      pendientes_en_arca: [
        reportRow({
          classification: 'pendiente_en_arca',
          composite_key: 'k2',
          sistema: null,
          arca: voucherRow({ numero: 200, importe_total: 500 }),
          divergencia_ars: null,
          antiguedad_meses: 3,
        }),
      ],
      posibles_coincidencias: [],
    });

    const buffer = await toPeriodoReportXlsxBuffer(
      sections,
      { id: 'periodo-1', tenant_id: 't1', mes: '2026-01-01', estado: 'abierto', tolerancia_ars: null, cerrado_at: null, cerrado_por: null },
      true,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(['Conciliados OK', 'Discrepancias y Alertas', 'Pendientes en ARCA', 'Posible Coincidencia']);

    const okSheet = workbook.getWorksheet('Conciliados OK')!;
    expect(okSheet.getCell('A1').value).toBe('Conciliación de Período — 2026-01-01 — Conciliados OK');
    expect(String(okSheet.getCell('A2').value)).toContain('Vista en vivo');
    expect(okSheet.getRow(4).getCell(1).value).toBe('Clasificación');
    expect(okSheet.getRow(4).getCell(1).fill).toMatchObject({ fgColor: { argb: 'FF2E7D32' } });
    expect(okSheet.getRow(5).getCell(1).value).toBe(CLASSIFICATION_LABELS.conciliado_ok);
    expect(okSheet.getRow(5).getCell(7).numFmt).toBe('#,##0.00'); // Importe ARCA column

    const pendientesSheet = workbook.getWorksheet('Pendientes en ARCA')!;
    expect(pendientesSheet.getRow(5).getCell(10).value).toBe(3); // Antigüedad (meses)
    expect(pendientesSheet.getRow(5).getCell(5).value).toBe(200); // Número

    const emptySheet = workbook.getWorksheet('Discrepancias y Alertas')!;
    expect(String(emptySheet.getCell('A5').value)).toContain('Sin comprobantes');
  });

  it('formats fecha_emision as dd/mm/yyyy', async () => {
    const sections = buildPeriodoExportSections({
      conciliados_ok: [],
      discrepancias_y_alertas: [],
      pendientes_en_arca: [
        reportRow({
          classification: 'pendiente_en_arca',
          composite_key: 'k1',
          sistema: null,
          arca: voucherRow({ fecha: '2026-03-05' }),
          divergencia_ars: null,
          antiguedad_meses: 1,
        }),
      ],
      posibles_coincidencias: [],
    });

    const buffer = await toPeriodoReportXlsxBuffer(
      sections,
      { id: 'p1', tenant_id: 't1', mes: '2026-03-01', estado: 'cerrado', tolerancia_ars: '0.99', cerrado_at: '2026-04-01T00:00:00Z', cerrado_por: null },
      false,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Pendientes en ARCA')!;
    expect(sheet.getRow(5).getCell(6).value).toBe('05/03/2026');
    expect(String(sheet.getCell('A2').value)).toContain('Snapshot congelado');
  });
});
