/**
 * PendientesArcaChart — RF-27: hand-rolled inline SVG bar chart
 * from a single GET /api/tenants/:id/pendientes-historico fetch.
 * Grouped by fecha.slice(0,7) (last 12 months).
 * Native <title> tooltips per bar. Zero new dependencies.
 */

'use client';

import { useMemo } from 'react';
import type { PendientesHistoricoResult } from '@/lib/api';

/**
 * Bucket a YYYY-MM-DD date string to its YYYY-MM month bucket.
 */
function bucketMonth(fecha: string | null): string | null {
  if (!fecha) return null;
  return fecha.slice(0, 7); // e.g. "2026-07"
}

/**
 * Compute the last 12 month buckets from `now` backward.
 * Builds each bucket from day 1 of its month — using `now`'s day-of-month
 * (e.g. via `Date#setMonth`) would roll days 29-31 over into a neighboring
 * month on shorter months, colliding two buckets into one.
 * `now` is injectable for testability (defaults to the real current date).
 */
export function last12MonthBuckets(now: Date = new Date()): string[] {
  const buckets = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const bucket = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.add(bucket);
  }
  return Array.from(buckets).sort();
}

/** Gradient definition for the bars. */
function createGradientDefs() {
  return (
    <defs key="gradient-defs">
      <linearGradient
        id="indigo-gradient"
        x1="0%"
        y1="0%"
        x2="0%"
        y2="100%"
      >
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
  );
}

/** Exported pure utility for testability. */
export function processData(
  result: PendientesHistoricoResult,
): {
  buckets: string[];
  bucketValues: { [key: string]: number };
  totals: number;
} {
  // Start with last 12 months
  const orderedBuckets = last12MonthBuckets();
  const bucketValues: { [key: string]: number } = {};
  orderedBuckets.forEach((b) => (bucketValues[b] = 0));

  // Aggregate pendientes by month bucket
  for (const row of result.pendientes) {
    const month = bucketMonth(row.fecha);
    if (month && bucketValues.hasOwnProperty(month)) {
      bucketValues[month] = (bucketValues[month] ?? 0) + (row.importe_total ?? 0);
    }
  }

  // Calculate total importe
  const totalImporte = result.pendientes
    .filter((p) => p.importe_total != null)
    .reduce((sum, p) => sum + (p.importe_total ?? 0), 0);

  return {
    buckets: orderedBuckets,
    bucketValues,
    totals: totalImporte,
  };
}

/** Renderiza una tarjeta de totales + gráfico de barras SVG manual.
 * - Totales: count_pendientes y Σ importe_total
 * - Barras agrupedas por mes (últimos 12 meses), ordenadas de más reciente a más antiguo
 * - <title> tooltips nativos por cada barra
 * - Estado vacío: "Sin pendientes ARCA" cuando count_pendientes = 0
 */
export function PendientesArcaChartComponent({
  result,
  className = '',
}: {
  result: PendientesHistoricoResult;
  className?: string;
}) {
  // RF-27: exactly ONE GET tenants/:id/pendientes-historico call feeds this
  // whole section — SectionC already fetched `result`, so the chart derives
  // its buckets synchronously from that same prop instead of re-fetching.
  const chartData = useMemo(() => processData(result), [result]);

  // Empty state when no pendientes - check BEFORE loading so 0-count shows immediately.
  // No own card wrapper here: the caller (Dashboard's SectionC) already
  // renders the single surrounding card for this section.
  if (result.count_pendientes === 0) {
    return (
      <p className={`text-sm text-slate-500 dark:text-slate-400 ${className}`}>
        Sin pendientes ARCA
      </p>
    );
  }

  const { buckets, bucketValues, totals } = chartData;
  const totalImporte = totals;

  // Determine max value for scaling. `Math.max` of an all-zero bucket set
  // legitimately returns 0 (every pendiente fell outside the rolling
  // 12-month window) — guard that case explicitly so bar heights below
  // don't divide by zero and produce NaN.
  const rawMaxBucketValue = Object.values(bucketValues).length > 0
    ? Math.max(...Object.values(bucketValues))
    : 0;
  const maxBucketValue = rawMaxBucketValue > 0 ? rawMaxBucketValue : 1;

  // Get the last 12 month buckets in order (most recent first)
  const orderedBuckets = last12MonthBuckets();

  const chartWidth = 400;
  const chartHeight = 200;
  const barWidth = 30;
  const barGap = 10;
  const leftMargin = 40;
  const rightMargin = 20;
  const topMargin = 20;
  const bottomMargin = 40;
  const usableWidth = chartWidth - leftMargin - rightMargin;
  const usableHeight = chartHeight - topMargin - bottomMargin;
  const bucketCount = orderedBuckets.length;

  const barWidthAdjusted = (usableWidth - (bucketCount - 1) * barGap) / bucketCount;

  // Build chart SVG content
  const svgParts: React.ReactNode[] = [];

  // Gradient defs
  svgParts.push(createGradientDefs());

  // Axis line
  svgParts.push(
    <line
      key="axis"
      x1={leftMargin}
      y1={usableHeight + topMargin}
      x2={leftMargin + usableWidth}
      y2={usableHeight + topMargin}
      stroke="#cbd5e0"
      strokeWidth={1}
    />
  );

  // Bars and month labels
  orderedBuckets.forEach((bucket, i) => {
    const value = bucketValues[bucket] ?? 0;
    const x = leftMargin + i * (barWidthAdjusted + barGap);
    const barHeight = (usableHeight * value) / maxBucketValue;

    const monthLabel = bucket; // already YYYY-MM format

    svgParts.push(
      <g
        key={`bar-${bucket}`}
        transform={`translate(${x + barWidth / 2}, ${topMargin})`}
      >
        <rect
          x={0}
          y={chartHeight - barHeight}
          width={barWidthAdjusted}
          height={barHeight}
          fill="url(#indigo-gradient)"
          stroke={value > 0 ? '#3182ce' : '#6b7280'}
          strokeWidth={1}
        />
        <title>
          {monthLabel}: ${value.toLocaleString('es-AR')}
        </title>
        <text
          x={barWidth / 2}
          y={barHeight > 20 ? chartHeight - barHeight + 10 : chartHeight - 5}
          textAnchor="middle"
          fontSize={10}
          fill={value > 0 ? '#3182ce' : '#6b7280'}
        >
          {monthLabel}
        </text>
      </g>
    );
  });

  // No own card wrapper, and no "Ver histórico completo" link here — the
  // caller (Dashboard's SectionC) owns the single surrounding card and the
  // one real "Ver histórico completo" button (avoids a duplicated card +
  // a dead, non-functional link rendered alongside the working one).
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Totals card */}
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-indigo-600 dark:text-indigo-400 text-2xl font-bold">
            {result.count_pendientes}
          </p>
          <p className="text-slate-500 dark:text-slate-400">
            total pendientes ARCA
          </p>
        </div>
        <div>
          <p className="text-indigo-600 dark:text-indigo-400 text-2xl font-bold">
            ${totalImporte.toLocaleString('es-AR')}
          </p>
          <p className="text-slate-500 dark:text-slate-400">
            total importe
          </p>
        </div>
      </div>

      {/* SVG chart */}
      <svg
        width={chartWidth}
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="overflow-hidden"
      >
        {svgParts}
      </svg>
    </div>
  );
}

/** Re-export for compatibility with Dashboard import. */
export { PendientesArcaChartComponent as PendientesArcaChart };