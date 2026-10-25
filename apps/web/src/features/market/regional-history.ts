/**
 * Regional price history: selection state, summary and geometry. Pure port of the logic in
 * legacy OpenNEXT-history-chart.js (`OpenNEXTRegionalHistory`); rendering lives in
 * RegionalHistoryChart.tsx.
 */
import type { CatalogRegion, RegionalHistoryResponse, RegionalPoint, RegionalSeries } from '@opennext/contracts';
import { cleanLabel, METRIC_DASH, METRIC_SHORT, metricsOf, primaryMetric, regionLabel, type PriceMetric, type Region } from './catalog';

export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const moneyShort = (value: unknown): string => (isNumber(value) ? '$' + value.toFixed(2) : '—');

export const dateLabel = (time: number | string): string =>
  new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const timeLabel = (time: number | string, daily: boolean): string =>
  new Date(time).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(daily ? {} : { hour: '2-digit', minute: '2-digit' }),
    timeZone: 'UTC',
  }) + (daily ? '' : ' UTC');

export const seriesColor = (index: number): string =>
  ['#315f49', '#678bad', '#b18843', '#9671a7', '#298986', '#b36762'][index] || `hsl(${Math.round(index * 137.508) % 360} 48% 38%)`;
export const seriesDash = (index: number): string => ['', '8 4', '2 4', '10 3 2 3'][Math.floor(index / 6) % 4];

export interface HistorySelection {
  model: string;
  count: number | string;
  region: string;
  term: string;
  period: string;
  priceMetric: PriceMetric;
  priceMetrics: PriceMetric[];
}

export const selectionKey = (S: HistorySelection): string => [S.model, S.count, S.region, S.term].join('|');

export function regionName(series: { name?: string | null; region: string }, data: { regions?: CatalogRegion[] }, regions: readonly Region[]): string {
  const region = data.regions?.find((item) => item.code === series.region);
  return cleanLabel(series.name) || cleanLabel(region?.city || region?.name) || cleanLabel(regionLabel(regions, series.region)) || 'Region not specified';
}

export interface KnownSeries {
  id: string;
  region: string;
  name?: string | null;
  configuration?: string | null;
  gpuCount?: number | null;
  styleIndex: number;
  points: RegionalPoint[];
}

export interface Presentation {
  name: string;
  description: string;
  label: string;
}

export function presentation(series: KnownSeries, known: KnownSeries[], data: RegionalHistoryResponse, regions: readonly Region[]): Presentation {
  const name = regionName(series, data, regions);
  const detail = cleanLabel(series.configuration);
  const peers = known.filter((item) => regionName(item, data, regions) === name && cleanLabel(item.configuration) === detail);
  const distinction = peers.length > 1 ? 'Series ' + (peers.findIndex((item) => item.id === series.id) + 1) : '';
  const description = [detail, distinction].filter(Boolean).join(' · ');
  return { name, description, label: [name, description].filter(Boolean).join(' · ') };
}

export const metricText = (S: HistorySelection): string => metricsOf(S).map((metric) => METRIC_SHORT[metric]).join(' / ');

export function valueOf(p: RegionalPoint, S: HistorySelection, data: { metric?: string | null }, metric: PriceMetric = primaryMetric(S)): number | null {
  if (Object.prototype.hasOwnProperty.call(p, metric)) return isNumber(p[metric]) ? p[metric] : null;
  return data.metric === metric && isNumber(p.value) ? p.value : null;
}

/** Per-selection chart choices: which series are drawn, picker state and remembered styles. */
export interface ChoiceState {
  selected: string[];
  initialized: boolean;
  open: boolean;
  query: string;
  focus: string | null;
  metricFocus: PriceMetric | null;
  catalog: Map<string, { id: string; region: string; name?: string | null; configuration?: string | null; gpuCount?: number | null; styleIndex: number }>;
}

export const emptyChoice = (): ChoiceState => ({ selected: [], initialized: false, open: false, query: '', focus: null, metricFocus: null, catalog: new Map() });

export interface SelectionResult {
  /** Reconciled choices (a new object; commit it to the store when it differs from the input). */
  state: ChoiceState;
  known: KnownSeries[];
  eligible: RegionalSeries[];
  selected: RegionalSeries[];
  /** True when `state` differs from the input (catalog grew or defaults were initialised). */
  changed: boolean;
}

/** Reconcile the remembered choices with the latest data without mutating the input. */
export function selection(S: HistorySelection, data: RegionalHistoryResponse, input: ChoiceState): SelectionResult {
  const current = (data.series || []).filter((s) => Number.isInteger(s.gpuCount) && (s.gpuCount as number) > 0);
  const catalog = new Map(input.catalog);
  let changed = false;
  for (const s of current) {
    const existing = catalog.get(s.id);
    const entry = { id: s.id, region: s.region, name: s.name, configuration: s.configuration, gpuCount: s.gpuCount, styleIndex: existing?.styleIndex ?? catalog.size };
    if (!existing || existing.name !== entry.name || existing.configuration !== entry.configuration || existing.gpuCount !== entry.gpuCount || existing.region !== entry.region) {
      catalog.set(s.id, entry);
      changed = true;
    }
  }
  const known: KnownSeries[] = [...catalog.values()].map((s) => ({ ...s, points: current.find((row) => row.id === s.id)?.points || [] }));
  const eligible = current.filter((s) =>
    s.points.some((p) => Number.isFinite(Date.parse(p.time)) && metricsOf(S).some((metric) => isNumber(valueOf(p, S, data, metric)))),
  );
  let selected = input.selected;
  let initialized = input.initialized;
  if (!initialized && eligible.length) {
    selected = eligible.slice(0, 3).map((s) => s.id);
    initialized = true;
    changed = true;
  }
  let focus = input.focus;
  if (focus !== null && !selected.includes(focus)) {
    focus = null;
    changed = true;
  }
  let metricFocus = input.metricFocus;
  if (metricFocus !== null && !metricsOf(S).includes(metricFocus)) {
    metricFocus = null;
    changed = true;
  }
  const state: ChoiceState = changed ? { ...input, catalog, selected, initialized, focus, metricFocus } : input;
  return { state, known, eligible, selected: selected.map((id) => eligible.find((s) => s.id === id)).filter((s): s is RegionalSeries => Boolean(s)), changed };
}

export interface HistorySummary {
  latest: number;
  change: number | null;
  points: number;
  region: string;
  last: string;
  selected: number;
  unit: 'gpu';
}

export function summary(S: HistorySelection, data: RegionalHistoryResponse | null | undefined, state: ChoiceState, regions: readonly Region[]): HistorySummary | null {
  if (!data) return null;
  const { selected } = selection(S, data, state);
  const primary = selected.find((series) => series.points.some((point) => Number.isFinite(Date.parse(point.time)) && isNumber(valueOf(point, S, data))));
  if (!primary) return null;
  const points = primary.points
    .map((p) => ({ ...p, value: valueOf(p, S, data) }))
    .filter((p): p is RegionalPoint & { value: number } => isNumber(p.value) && Number.isFinite(Date.parse(p.time)));
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    latest: last.value,
    change: points.length > 1 && first.value > 0 ? (last.value / first.value - 1) * 100 : null,
    points: points.length,
    region: regionName(primary, data, regions),
    last: last.time,
    selected: selected.length,
    unit: 'gpu',
  };
}

export interface PlotPoint extends RegionalPoint {
  value: number;
  timestamp: number;
  x: number;
  y: number;
}

export interface PlotSeries {
  id: string;
  region: string;
  metric: PriceMetric;
  display: Presentation;
  color: string;
  dash: string;
  points: PlotPoint[];
}

export interface Geometry {
  series: PlotSeries[];
  w: number;
  h: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  min: number;
  max: number;
  from: number;
  to: number;
  gap: number;
  daily: boolean;
  metric: PriceMetric;
  metrics: PriceMetric[];
  grid: { y: number; label: string }[];
  ticks: number[];
}

/** Computes plotted series and axes for the selected curves. Returns null when nothing is drawable. */
export function geometry(S: HistorySelection, data: RegionalHistoryResponse, result: SelectionResult, regions: readonly Region[], width: number): Geometry | null {
  const { state, known, selected } = result;
  const metrics = metricsOf(S);
  const series: PlotSeries[] = selected
    .flatMap((s) =>
      metrics.map((metric) => {
        const entry = state.catalog.get(s.id)!;
        return {
          id: s.id,
          region: s.region,
          metric,
          display: presentation({ ...entry, points: s.points }, known, data, regions),
          color: seriesColor(entry.styleIndex),
          dash: metrics.length > 1 ? METRIC_DASH[metric] : seriesDash(entry.styleIndex),
          points: s.points
            .map((p) => ({ ...p, value: valueOf(p, S, data, metric), timestamp: Date.parse(p.time), x: 0, y: 0 }))
            .filter((p): p is PlotPoint => isNumber(p.value) && Number.isFinite(p.timestamp)),
        };
      }),
    )
    .filter((s) => s.points.length);
  if (!series.length) return null;
  const w = Math.max(340, Math.min(1400, width - 40));
  const h = 360;
  const left = 18;
  const right = 70;
  const top = 22;
  const bottom = 44;
  let low = Infinity;
  let high = -Infinity;
  let from = Infinity;
  let to = -Infinity;
  for (const s of series)
    for (const p of s.points) {
      low = Math.min(low, p.value);
      high = Math.max(high, p.value);
      from = Math.min(from, p.timestamp);
      to = Math.max(to, p.timestamp);
    }
  const pad = Math.max((high - low) * 0.13, high * 0.03, 0.02);
  const min = Math.max(0, low - pad);
  const max = high + pad;
  const px = (time: number) => (from === to ? (left + w - right) / 2 : left + ((time - from) / (to - from)) * (w - left - right));
  const py = (value: number) => top + ((max - value) / (max - min)) * (h - top - bottom);
  for (const s of series) s.points = s.points.map((p) => ({ ...p, x: px(p.timestamp), y: py(p.value) }));
  const gap = (data.meta?.bucketMinutes || 1440) * 60000 * 1.5;
  const grid = Array.from({ length: 4 }, (_, i) => {
    const value = min + ((max - min) * i) / 3;
    return { y: py(value), label: moneyShort(value) };
  });
  const observedTimes = [...new Set(series.flatMap((s) => s.points.map((p) => p.timestamp)))].sort((a, b) => a - b);
  const tickCount = w < 600 ? 3 : 5;
  const ticks =
    (data.meta?.bucketMinutes || 0) >= 1440 && observedTimes.length <= 6
      ? observedTimes
      : from === to
        ? [from]
        : Array.from({ length: tickCount }, (_, i) => from + ((to - from) * i) / (tickCount - 1));
  return { series, w, h, top, bottom, left, right, min, max, from, to, gap, daily: (data.meta?.bucketMinutes || 0) >= 1440, metric: primaryMetric(S), metrics, grid, ticks };
}

/** SVG path for a series: gaps larger than one and a half buckets break the line. */
export function seriesPath(s: PlotSeries, gap: number): string {
  return s.points
    .map((p, i) => (i && p.timestamp - s.points[i - 1].timestamp <= gap ? 'L' : 'M') + p.x.toFixed(2) + ',' + p.y.toFixed(2))
    .join(' ');
}

/** Points drawn as dots: isolated observations and run boundaries. */
export function seriesDots(s: PlotSeries, gap: number): PlotPoint[] {
  return s.points.filter(
    (p, i) =>
      s.points.length === 1 ||
      ((!i || p.timestamp - s.points[i - 1].timestamp > gap) && (i === s.points.length - 1 || s.points[i + 1].timestamp - p.timestamp > gap)),
  );
}

export function nearestPoint(geo: Geometry, x: number, y: number): { series: PlotSeries; point: PlotPoint } | null {
  let selected: PlotSeries | undefined;
  let point: PlotPoint | undefined;
  let distance = Infinity;
  for (const series of geo.series)
    for (const candidate of series.points) {
      const d = Math.abs(candidate.x - x) * 2 + Math.abs(candidate.y - y);
      if (d < distance) {
        distance = d;
        selected = series;
        point = candidate;
      }
    }
  return selected && point ? { series: selected, point } : null;
}

export interface PriceRange {
  min: number;
  max: number;
  model: string;
}

export function priceRange(data: RegionalHistoryResponse | null | undefined, canonicalModel: string): PriceRange | null {
  if (!data) return null;
  const values = data.series.flatMap((series) => series.points.flatMap((point) => [point.min, point.avg, point.max, point.value])).filter(isNumber);
  return values.length
    ? values.reduce((range, value) => ({ min: Math.min(range.min, value), max: Math.max(range.max, value), model: range.model }), { min: Infinity, max: -Infinity, model: canonicalModel })
    : null;
}
