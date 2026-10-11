import { render, screen } from '@testing-library/react';
import {
  PendientesArcaChartComponent,
  processData,
} from './PendientesArcaChart';
import type { PendientesHistoricoResult } from '@/lib/api';

const mockResultWithData: PendientesHistoricoResult = {
  tenant: { id: 'T1', name: 'Tenant', created_at: '2026-01-01T00:00:00Z' },
  pendientes: [
    {
      id: 'p1',
      cuit_emisor: '30682503750',
      tipo_cbte: 1,
      punto_venta: 1,
      numero: 100,
      importe_total: 500,
      iva: null,
      fecha: '2026-07-15',
      file_source: 'arca',
      estado: 'conciliado',
      periodo_alta_id: '',
      antiguedad_meses: 0,
    },
    {
      id: 'p2',
      cuit_emisor: '30682503751',
      tipo_cbte: 1,
      punto_venta: 2,
      numero: 200,
      importe_total: 750,
      iva: null,
      fecha: '2026-07-20',
      file_source: 'arca',
      estado: 'conciliado',
      periodo_alta_id: '',
      antiguedad_meses: 0,
    },
    {
      id: 'p3',
      cuit_emisor: '30682503752',
      tipo_cbte: 2,
      punto_venta: 1,
      numero: 300,
      importe_total: 250,
      iva: null,
      fecha: '2026-06-10',
      file_source: 'arca',
      estado: 'conciliado',
      periodo_alta_id: '',
      antiguedad_meses: 0,
    },
  ],
  count_pendientes: 3,
  excluidos_previos_a_alta: [],
  count_excluidos_previos_a_alta: 0,
};

const emptyResult = {
  ...mockResultWithData,
  count_pendientes: 0,
  pendientes: [],
};

describe('PendientesArcaChart - processData (pure utility)', () => {
  // The hardcoded '2026-07'/'2026-06' bucket expectations below only hold
  // because of the current wall-clock date — pin it so the test is
  // deterministic regardless of when it actually runs.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('buckets dates correctly by month', () => {
    const processed = processData(mockResultWithData);

    // Should have last 12 buckets including Jul 2026 and Jun 2026
    expect(processed.buckets.length).toBe(12);
    expect(processed.bucketValues['2026-07']).toBe(1250); // 500 + 750
    expect(processed.bucketValues['2026-06']).toBe(250);
    expect(processed.totals).toBe(1500); // 500 + 750 + 250
  });

  it('returns zero totals for empty pendientes', () => {
    const processed = processData(emptyResult);

    expect(processed.buckets.length).toBe(12);
    expect(processed.totals).toBe(0);
    // All bucket values should be 0
    expect(processed.bucketValues['2026-07']).toBe(0);
    expect(processed.bucketValues['2026-06']).toBe(0);
  });

  it('does not roll over into the wrong month when pinned to the 31st (date-rollover regression)', () => {
    // Regression for the classic JS Date bug: subtracting months from a
    // day-31 date without first pinning the day to 1 overflows into the
    // following month on any target month with fewer than 31 days. Pinned
    // to 2026-03-31: Feb 2026 has 28 days, so computing "1 month back"
    // without the day-1 pin lands on 2026-03-03 instead of 2026-02-xx,
    // duplicating the 2026-03 bucket and dropping 2026-02 entirely.
    jest.setSystemTime(new Date('2026-03-31'));

    const processed = processData(emptyResult);

    expect(processed.buckets.length).toBe(12);
    expect(processed.buckets).toContain('2026-02');
    expect(processed.buckets).toContain('2026-03');
    // No duplicate buckets from the overflow (a Set would silently absorb
    // the duplicate and under-count instead of throwing).
    expect(new Set(processed.buckets).size).toBe(processed.buckets.length);
  });
});

describe('PendientesArcaChartComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows "Sin pendientes ARCA" when count_pendientes is 0', () => {
    const { unmount } = render(
      <PendientesArcaChartComponent result={emptyResult} />
    );

    // Component checks count_pendientes === 0 BEFORE loading state,
    // so it shows the empty state immediately
    expect(screen.getByText('Sin pendientes ARCA')).toBeInTheDocument();

    unmount();
  });

  it('renders without crashing', () => {
    const { unmount } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );

    // Component should render without throwing
    expect(unmount).toBeDefined();
    unmount();
  });

  it('renders a native <title> tooltip per bar and zero bars for an empty result (RF-27)', () => {
    const { container, unmount } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );

    // 12 month buckets -> 12 <rect> bars, each with its own native <title>.
    const bars = container.querySelectorAll('svg rect');
    const titles = container.querySelectorAll('svg title');
    expect(bars.length).toBe(12);
    expect(titles.length).toBe(12);
    expect(titles[0].textContent).toMatch(/^\d{4}-\d{2}: \$/);

    unmount();

    const { container: emptyContainer, unmount: unmountEmpty } = render(
      <PendientesArcaChartComponent result={emptyResult} />
    );
    // count_pendientes === 0 shows the empty-state card, no <svg> at all.
    expect(emptyContainer.querySelectorAll('svg rect').length).toBe(0);
    unmountEmpty();
  });

  it('plots bar geometry inside the drawable area (regression: bars were double-offset by the margins)', () => {
    const { container, unmount } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );

    // chartHeight=200, topMargin=20, bottomMargin=40 -> usableHeight=140.
    const usableHeight = 140;

    const groups = Array.from(container.querySelectorAll('svg g'));
    const barGroups = groups.filter((g) => g.querySelector('title'));
    expect(barGroups.length).toBe(12);

    for (const g of barGroups) {
      const rect = g.querySelector('rect');
      const text = g.querySelector('text');
      expect(rect).not.toBeNull();
      const y = Number(rect!.getAttribute('y'));
      const height = Number(rect!.getAttribute('height'));

      // Every bar must stay within the margin-adjusted drawable height —
      // a bar using `chartHeight` as its reference frame would push
      // (y + height) well past `usableHeight` (by the 60px top+bottom
      // margin), overflowing the chart.
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + height).toBeLessThanOrEqual(usableHeight);

      // The value label must land inside the same drawable area.
      const labelY = Number(text!.getAttribute('y'));
      expect(labelY).toBeGreaterThanOrEqual(0);
      expect(labelY).toBeLessThanOrEqual(usableHeight);
    }

    // The bucket with the largest value (2026-07: 1250) should span the
    // full drawable height, i.e. sit flush with the top (y === 0).
    const tallestGroup = barGroups.find((g) => g.querySelector('title')!.textContent?.startsWith('2026-07:'));
    expect(tallestGroup).toBeDefined();
    const tallestRect = tallestGroup!.querySelector('rect')!;
    expect(Number(tallestRect.getAttribute('y'))).toBe(0);
    expect(Number(tallestRect.getAttribute('height'))).toBe(usableHeight);

    unmount();
  });

  it('interpolates the viewBox dimensions instead of emitting literal template braces', () => {
    const { container, unmount } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 400 200');

    unmount();
  });
});