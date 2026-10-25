import type { TickerPoint, TickerRecord } from '@opennext/contracts';

/** A current catalog quote cannot stand in for a seven-day historical series. */
export function validTickerRows(records: TickerRecord[]): TickerRecord[] {
  return records.filter(
    (row) =>
      row.term === 'Spot' &&
      row.historical === true &&
      Number.isFinite(row.perGpuHourly) &&
      (row.perGpuHourly as number) >= 0 &&
      (row.points || []).filter((p) => Number.isFinite(p.value) && (p.value as number) >= 0)
        .length > 1,
  );
}

export interface SparkRow {
  time: number;
  value: number | null;
}

export const sparkRows = (points: TickerPoint[]): SparkRow[] =>
  points
    .map((p) => ({
      time: Date.parse(p.date || p.time || p.timestamp || p.observedAt || ''),
      value: Number.isFinite(p.value) ? (p.value as number) : null,
    }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);

export interface SparkGeometry {
  path: string;
  dots: { x: number; y: number }[];
  last: { x: number; y: number };
  start: number;
  end: number;
  count: number;
}

const DAY = 86_400_000;

/**
 * Sparkline in a 370×90 viewBox. Gaps (missing values or more than 1.5 days between
 * observations) start a new sub-path so history is never bridged.
 */
export function sparkGeometry(points: TickerPoint[]): SparkGeometry | null {
  const rows = sparkRows(points);
  const valid = rows.filter((p): p is { time: number; value: number } => p.value !== null);
  if (!valid.length) return null;
  const min = Math.min(...valid.map((p) => p.value));
  const max = Math.max(...valid.map((p) => p.value));
  const spread = max - min;
  const pad = spread * 0.15 || Math.max(Math.abs(min) * 0.02, 0.01);
  const low = min - pad;
  const range = spread + pad * 2;
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  if (!firstRow || !lastRow) return null;
  const start = firstRow.time;
  const end = lastRow.time;
  const x = (t: number) => (start === end ? 185 : 8 + ((t - start) / (end - start)) * 354);
  const y = (v: number) => 82 - ((v - low) / range) * 74;
  let path = '';
  let previous: { time: number; value: number } | null = null;
  for (const p of rows) {
    if (p.value === null) {
      previous = null;
      continue;
    }
    const join = previous && p.time - previous.time <= DAY * 1.5;
    path += (join ? 'L' : 'M') + x(p.time).toFixed(2) + ',' + y(p.value).toFixed(2) + ' ';
    previous = { time: p.time, value: p.value };
  }
  const last = valid[valid.length - 1];
  if (!last) return null;
  return {
    path: path.trim(),
    dots: valid.map((p) => ({ x: +x(p.time).toFixed(2), y: +y(p.value).toFixed(2) })),
    last: { x: +x(last.time).toFixed(2), y: +y(last.value).toFixed(2) },
    start,
    end,
    count: valid.length,
  };
}

/** Percentage change between the first and last recorded values, or null. */
export function tickerChange(points: TickerPoint[]): number | null {
  const recorded = (points || []).filter((p) => Number.isFinite(p.value)) as { value: number }[];
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  return first && first.value > 0 && last ? (last.value / first.value - 1) * 100 : null;
}
