import { render, screen } from '@testing-library/react';
import {
  PendientesArcaChartComponent,
  processData,
  last12MonthBuckets,
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
});

describe('last12MonthBuckets (day-of-month collision bug)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 12 distinct consecutive month keys even when "now" is on day 29-31', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 31)); // 2026-03-31

    const buckets = last12MonthBuckets();

    expect(buckets.length).toBe(12);
    expect(new Set(buckets).size).toBe(12); // no duplicates from month-rollover
    expect(buckets).toEqual([
      '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    ]);
  });
});

describe('PendientesArcaChartComponent', () => {
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

  it('does not render its own "Ver histórico completo" link (that control lives once, in the caller)', () => {
    render(<PendientesArcaChartComponent result={mockResultWithData} />);
    expect(screen.queryByText(/Ver histórico completo/i)).not.toBeInTheDocument();
  });

  it('interpolates the viewBox with real dimensions, not a literal template string', () => {
    const { container } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 400 200');
  });

  it('every bar sits on the axis (local y + height === usableHeight), including the tallest bar', () => {
    // usableHeight = chartHeight(200) - topMargin(20) - bottomMargin(40) = 140.
    // The <g> wrapper already translates by topMargin, so bars must be
    // positioned in that LOCAL frame — using chartHeight instead of
    // usableHeight double-counts the translate and pushes every bar's
    // bottom edge past the axis (and the tallest bar's top past the top margin).
    const { container } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );
    const usableHeight = 140;

    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBe(12);
    rects.forEach((rect) => {
      const y = Number(rect.getAttribute('y'));
      const height = Number(rect.getAttribute('height'));
      expect(y + height).toBeCloseTo(usableHeight, 5);
    });
  });

  it('centers each bar group and its label on the slot computed with barWidthAdjusted, not the stale barWidth constant', () => {
    // leftMargin=40, usableWidth=340, barGap=10, bucketCount=12 ->
    // barWidthAdjusted = (340 - 11*10) / 12 = 230/12.
    const { container } = render(
      <PendientesArcaChartComponent result={mockResultWithData} />
    );
    const leftMargin = 40;
    const barGap = 10;
    const bucketCount = 12;
    const usableWidth = 340;
    const barWidthAdjusted = (usableWidth - (bucketCount - 1) * barGap) / bucketCount;

    const barGroups = Array.from(container.querySelectorAll('svg g[transform]'));
    expect(barGroups.length).toBe(12);

    // First bar's slot starts at x = leftMargin; its group should be
    // centered at leftMargin + barWidthAdjusted / 2, not leftMargin + 15
    // (half of the old fixed barWidth=30 constant).
    const firstTransform = barGroups[0].getAttribute('transform') ?? '';
    const match = firstTransform.match(/translate\(([-\d.]+),/);
    expect(match).not.toBeNull();
    const translateX = Number(match![1]);
    expect(translateX).toBeCloseTo(leftMargin + barWidthAdjusted / 2, 3);

    const firstText = barGroups[0].querySelector('text');
    expect(firstText).not.toBeNull();
    expect(Number(firstText!.getAttribute('x'))).toBeCloseTo(barWidthAdjusted / 2, 3);
  });

  it('never produces NaN bar attributes when every pendiente falls outside the last-12-months window', () => {
    const outOfWindowResult: PendientesHistoricoResult = {
      ...mockResultWithData,
      count_pendientes: 1,
      pendientes: [
        {
          ...mockResultWithData.pendientes[0],
          fecha: '2000-01-15', // always outside the rolling 12-month window
        },
      ],
    };

    const { container } = render(
      <PendientesArcaChartComponent result={outOfWindowResult} />
    );

    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBe(12);
    rects.forEach((rect) => {
      ['x', 'y', 'width', 'height'].forEach((attr) => {
        const value = rect.getAttribute(attr);
        expect(value).not.toBeNull();
        expect(Number.isNaN(Number(value))).toBe(false);
      });
    });
  });
});