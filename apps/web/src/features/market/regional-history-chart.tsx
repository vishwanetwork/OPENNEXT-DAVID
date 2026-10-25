'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { RegionalHistoryResponse } from '@opennext/contracts';
import {
  METRIC_DASH,
  METRIC_SHORT,
  metricsOf,
  PERIODS,
  primaryMetric,
  type PriceMetric,
  type Region,
} from './catalog';
import { useHistoryChoices } from './history-choices';
import {
  dateLabel,
  emptyChoice,
  geometry,
  metricText,
  nearestPoint,
  reconcileSelection,
  selectionKey,
  timeLabel,
  type HistorySelection,
  type PlotSeries,
} from './regional-history';
import { PricePlot, SeriesTable, type HoverState } from './price-plot';
import { RegionPicker } from './region-picker';
import './history-chart.css';

export { choiceStateFor } from './history-choices';

export interface PriceHoverDetail {
  model: string;
  region: string;
  metric: PriceMetric;
  price: number | null;
  min?: number | null;
  max?: number | null;
}

export interface RegionalHistoryChartProps {
  selection: HistorySelection;
  data: RegionalHistoryResponse;
  regions: readonly Region[];
  /** Period buttons; omit to hide the period row (the insight index uses a shared control). */
  onPeriod?: (period: string) => void;
  onPriceHover?: (detail: PriceHoverDetail) => void;
}

/** Multi-region price comparison chart with region picker, legend focus and hover tooltip. */
export function RegionalHistoryChart({
  selection,
  data,
  regions,
  onPeriod,
  onPriceHover,
}: RegionalHistoryChartProps) {
  const key = selectionKey(selection);
  const stored = useHistoryChoices((s) => s.map[key]);
  const commit = useHistoryChoices((s) => s.commit);
  const updateChoice = useHistoryChoices((s) => s.update);
  const update = (patch: Parameters<typeof updateChoice>[1]) => updateChoice(key, patch);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth || 900);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);

  const result = useMemo(
    () => reconcileSelection(selection, data, stored || emptyChoice()),
    [selection, data, stored],
  );
  const state = result.state;
  useEffect(() => {
    if (result.changed) commit(key, result.state);
  }, [result, commit, key]);
  const geo = useMemo(
    () => geometry(selection, data, result, regions, width),
    [selection, data, result, regions, width],
  );
  const metrics = metricsOf(selection);
  const metric = primaryMetric(selection);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [activeFocus, setActiveFocus] = useState<{ id: string | null; metric: PriceMetric | null }>(
    { id: null, metric: null },
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.open) searchRef.current?.focus();
  }, [state.open]);
  useEffect(() => {
    if (!state.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open], [role="dialog"], .overlay')) return;
      event.preventDefault();
      updateChoice(key, { open: false });
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.open, updateChoice, key]);

  const focusFor = (id: string | null, metricFocus: PriceMetric | null) => {
    const active = id || state.focus;
    const activeMetric = metricFocus || state.metricFocus;
    return { active, activeMetric };
  };
  const { active, activeMetric } = focusFor(activeFocus.id, activeFocus.metric);
  const lineStyle = (s: PlotSeries) => {
    const highlighted =
      (!active || s.id === active) && (!activeMetric || s.metric === activeMetric);
    const opacity =
      active || activeMetric ? (highlighted ? 1 : 0.12) : geo && geo.series.length > 8 ? 0.65 : 1;
    return { opacity, strokeWidth: highlighted && (active || activeMetric) ? 3 : 2 };
  };

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * geo.w;
    const y = ((event.clientY - rect.top) / rect.height) * geo.h;
    const hit = nearestPoint(geo, x, y);
    if (!hit) return;
    onPriceHover?.({
      model: selection.model,
      region: hit.series.region,
      metric: hit.series.metric,
      price: hit.point.value,
      min: hit.point.min,
      max: hit.point.max,
    });
    setHover({
      ...hit,
      left: Math.max(4, Math.min(rect.width - 250, (hit.point.x / geo.w) * rect.width + 10)),
    });
    setActiveFocus({ id: hit.series.id, metric: hit.series.metric });
  };
  const onLeave = () => {
    setHover(null);
    setActiveFocus({ id: null, metric: null });
  };

  const regionsList = [
    ...new Map(
      [
        ...result.known.map((s) => ({ code: s.region, name: s.name || undefined })),
        ...(data.regions || []),
      ].map((r) => [r.code, r]),
    ).values(),
  ];
  const term = data.term || selection.term || 'Spot';

  const controls = (
    <div className="history-controls">
      {onPeriod ? (
        <div className="periods">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              className={`period ${selection.period === period ? 'active' : ''}`}
              data-act="period"
              data-value={period}
              onClick={() => onPeriod(period)}
            >
              {period}
            </button>
          ))}
        </div>
      ) : null}
      <span className="capacity-unit">
        {metricText(selection)} · USD / GPU-hour · {term}
      </span>
    </div>
  );
  if (!geo) {
    const title = state.selected.length
      ? 'No recorded prices for the selected regions'
      : result.eligible.length || state.initialized
        ? 'Choose regions to compare'
        : `No ${term} prices for this configuration yet`;
    const note = state.selected.length
      ? 'Your region selection is saved. Try another price metric or time range; missing observations remain empty.'
      : result.eligible.length || state.initialized
        ? 'Open Compare regions to select any number of curves.'
        : 'Try another GPU model, region, count or market term. Unreported configurations remain empty.';
    return (
      <div ref={host}>
        {controls}
        <RegionPicker
          state={state}
          result={result}
          regionsList={regionsList}
          data={data}
          regions={regions}
          update={update}
          toggleRef={toggleRef}
          searchRef={searchRef}
        />
        <div className="aws-history-empty">
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
      </div>
    );
  }

  const legendSeries = [...new Map(geo.series.map((s) => [s.id, s])).values()];
  const snapshot = data.meta?.snapshotAsOf
    ? `Snapshot through ${dateLabel(data.meta.snapshotAsOf + 'T00:00:00Z')}`
    : data.meta?.lastSync
      ? `Updated ${timeLabel(data.meta.lastSync, false)}`
      : 'Recorded observations';
  return (
    <div ref={host} onPointerLeave={onLeave}>
      {controls}
      <RegionPicker
        state={state}
        result={result}
        regionsList={regionsList}
        data={data}
        regions={regions}
        update={update}
        toggleRef={toggleRef}
        searchRef={searchRef}
      />
      <div className="history-legend" aria-label="Price curve legend">
        {legendSeries.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`history-legend-chip${active === s.id ? ' primary' : ''}`}
            data-region-focus={s.id}
            aria-pressed={state.focus === s.id}
            title={`Focus ${s.display.label}`}
            onClick={() => update({ focus: state.focus === s.id ? null : s.id })}
            onPointerEnter={() => setActiveFocus({ id: s.id, metric: null })}
            onFocus={() => setActiveFocus({ id: s.id, metric: null })}
            onBlur={() => setActiveFocus({ id: null, metric: null })}
          >
            <i
              style={{
                ['--series-color' as string]: s.color,
                ...(metrics.length === 1 && s.dash ? { borderTopStyle: 'dashed' } : {}),
              }}
            />
            <span>
              {s.display.name}
              {s.display.description ? <small>{s.display.description}</small> : null}
            </span>
          </button>
        ))}
      </div>
      {metrics.length > 1 ? (
        <div className="history-metric-key" aria-label="Price metric line styles">
          <span>Line style</span>
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              className={`history-metric-chip${activeMetric === m ? ' primary' : ''}`}
              data-metric-focus={m}
              aria-pressed={state.metricFocus === m}
              title={`Focus ${METRIC_SHORT[m].toLowerCase()} prices`}
              onClick={() => update({ metricFocus: state.metricFocus === m ? null : m })}
              onPointerEnter={() => setActiveFocus({ id: null, metric: m })}
              onFocus={() => setActiveFocus({ id: null, metric: m })}
              onBlur={() => setActiveFocus({ id: null, metric: null })}
            >
              <svg viewBox="0 0 28 10" aria-hidden="true">
                <line
                  x1="1"
                  x2="27"
                  y1="5"
                  y2="5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={METRIC_DASH[m]}
                  strokeLinecap="round"
                />
              </svg>
              {METRIC_SHORT[m]}
            </button>
          ))}
          <small>Color identifies region · Line style identifies metric</small>
        </div>
      ) : null}
      <div className="history-range">
        <span>
          {dateLabel(geo.from)} – {dateLabel(geo.to)}
        </span>
        <span>
          {geo.series.length} curves · {metricText(selection)} price
        </span>
      </div>
      <PricePlot
        selection={selection}
        geo={geo}
        hover={hover}
        lineStyle={lineStyle}
        onMove={onMove}
      />
      <div className="history-footnote">
        <span>
          Actual {metricText(selection).toLowerCase()} observations · Missing dates remain gaps
        </span>
        <span>{snapshot}</span>
      </div>
      <details className="regional-method">
        <summary>Price methodology</summary>
        <p>
          {data.meta?.aggregation || 'Recorded prices for comparable configurations.'}{' '}
          {data.meta?.missingDataPolicy || ''} All prices use USD / GPU-hour; quotes confirm
          capacity.
        </p>
      </details>
      <SeriesTable geo={geo} metrics={metrics} metric={metric} />
    </div>
  );
}
