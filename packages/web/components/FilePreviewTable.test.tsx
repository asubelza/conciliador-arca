import { render, screen } from '@testing-library/react';
import { FilePreviewTable } from './FilePreviewTable';
import type { PreviewResult } from '@/lib/api';

const PREVIEW: PreviewResult = {
  arca: {
    total: 2,
    ok: 1,
    errors: 1,
    rows: [
      { ok: true, cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, fecha_emision: '2026-04-01', importe_total_ars: 1000 },
      { ok: false, cuit_emisor: '30222222223', tipo_cbte: 0, punto_venta: 1, numero: 101, fecha_emision: '2026-04-02', importe_total_ars: 0 },
    ],
  },
  contabilidad: {
    total: 1,
    ok: 1,
    errors: 0,
    rows: [
      { ok: true, cuit_emisor: '30111111112', tipo_cbte: 1, punto_venta: 1, numero: 100, fecha_emision: '2026-04-01', importe_total_ars: 1000 },
    ],
  },
};

describe('T37: FilePreviewTable', () => {
  it('renders both sides with their OK/error/total counts and every row (no sampling)', () => {
    render(<FilePreviewTable preview={PREVIEW} />);

    expect(screen.getByText('Archivo ARCA')).toBeInTheDocument();
    expect(screen.getByText('Archivo Contabilidad')).toBeInTheDocument();

    // ARCA: 2 filas totales, 1 OK, 1 con error.
    expect(screen.getByText('2 filas')).toBeInTheDocument();
    expect(screen.getAllByText('1 OK').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 con error')).toBeInTheDocument();

    // Every CUIT from every row is rendered — nothing sampled/truncated.
    // '30111111112' appears once per side (ARCA's OK row + Contabilidad's row).
    expect(screen.getAllByText('30111111112')).toHaveLength(2);
    expect(screen.getByText('30222222223')).toBeInTheDocument();
  });

  it('shows "Sin filas." for a side with no rows', () => {
    render(
      <FilePreviewTable
        preview={{
          arca: { total: 0, ok: 0, errors: 0, rows: [] },
          contabilidad: PREVIEW.contabilidad,
        }}
      />,
    );

    expect(screen.getByText('Sin filas.')).toBeInTheDocument();
  });
});
