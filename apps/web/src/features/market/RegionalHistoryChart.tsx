'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RegionalHistoryResponse } from '@opennext/contracts';
import { METRIC_DASH, METRIC_SHORT, metricsOf, PERIODS, primaryMetric, type PriceMetric, type Region } from './catalog';
import { useHistoryChoices } from './history-choices';
import {
  dateLabel,
  emptyChoice,
  geometry,
  metricText,
  moneyShort,
  nearestPoint,
  presentation,
  regionName,
  selection,
  selectionKey,
  seriesDots,
  seriesPath,
  timeLabel,
  type HistorySelection,
  type PlotPoint,
  type PlotSeries,
} from './regional-history';
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
  S: HistorySelection;
  data: RegionalHistoryResponse;
  regions: readonly Region[];
  /** Period buttons; omit to hide the period row (the insight index uses a shared control). */
  onPeriod?: (period: string) => void;
  onPriceHover?: (detail: PriceHoverDetail) => void;
}

/** Multi-region price comparison chart with region picker, legend focus and hover tooltip. */
export function RegionalHistoryChart({ S, data, regions, onPeriod, onPriceHover }: RegionalHistoryChartProps) {
  const key = selectionKey(S);
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

  const result = useMemo(() => selection(S, data, stored || emptyChoice()), [S, data, stored]);
  const state = result.state;
  useEffect(() => {
    if (result.changed) commit(key, result.state);
  }, [result, commit, key]);
  const geo = useMemo(() => geometry(S, data, result, regions, width), [S, data, result, regions, width]);
  const metrics = metricsOf(S);
  const metric = primaryMetric(S);
  const [hover, setHover] = useState<{ series: PlotSeries; point: PlotPoint; left: number } | null>(null);
  const [activeFocus, setActiveFocus] = useState<{ id: string | null; metric: PriceMetric | null }>({ id: null, metric: null });
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
    const highlighted = (!active || s.id === active) && (!activeMetric || s.metric === activeMetric);
    const opacity = active || activeMetric ? (highlighted ? 1 : 0.12) : geo && geo.series.length > 8 ? 0.65 : 1;
    return { opacity, strokeWidth: highlighted && (active || activeMetric) ? 3 : 2 };
  };

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * geo.w;
    const y = ((event.clientY - rect.top) / rect.height) * geo.h;
    const hit = nearestPoint(geo, x, y);
    if (!hit) return;
    onPriceHover?.({ model: S.model, region: hit.series.region, metric: hit.series.metric, price: hit.point.value, min: hit.point.min, max: hit.point.max });
    setHover({ ...hit, left: Math.max(4, Math.min(rect.width - 250, (hit.point.x / geo.w) * rect.width + 10)) });
    setActiveFocus({ id: hit.series.id, metric: hit.series.metric });
  };
  const onLeave = () => {
    setHover(null);
    setActiveFocus({ id: null, metric: null });
  };

  const regionsList = [...new Map([...result.known.map((s) => ({ code: s.region, name: s.name || undefined })), ...(data.regions || [])].map((r) => [r.code, r])).values()];
  const term = data.term || S.term || 'Spot';
  const query = state.query.trim().toLowerCase();

  const controls = (
    <div className="history-controls">
      {onPeriod ? (
        <div className="periods">
          {PERIODS.map((period) => (
            <button key={period} type="button" className={`period ${S.period === period ? 'active' : ''}`} data-act="period" data-value={period} onClick={() => onPeriod(period)}>
              {period}
            </button>
          ))}
        </div>
      ) : null}
      <span className="capacity-unit">
        {metricText(S)} · USD / GPU-hour · {term}
      </span>
    </div>
  );
  let visibleGroups = 0;
  const picker = (
    <div className="history-selection">
      <button ref={toggleRef} type="button" className="btn secondary small" data-region-toggle aria-expanded={state.open} onClick={() => update({ open: !state.open })}>
        Compare regions <span className="history-count">{state.selected.length} selected</span>⌄
      </button>
      <span>All {regionsList.length} regions available · Hover or focus a legend to isolate prices</span>
      {state.open ? (
        <section className="history-picker" aria-label="Choose regions for price comparison" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); update({ open: false }); toggleRef.current?.focus(); } }}>
          <div className="history-picker-head">
            <strong>Compare global prices</strong>
            <button type="button" data-region-toggle aria-label="Close region picker" onClick={() => { update({ open: false }); toggleRef.current?.focus(); }}>×</button>
          </div>
          <input ref={searchRef} type="search" data-region-search aria-label="Search regions" placeholder="Search region or configuration…" value={state.query} onChange={(e) => update({ query: e.target.value })} />
          <div className="history-picker-actions">
            <button type="button" data-region-all onClick={() => update({ selected: result.known.map((s) => s.id), initialized: true })}>Select all</button>
            <button type="button" data-region-clear onClick={() => update({ selected: [], initialized: true })}>Clear</button>
            <span>{state.selected.length} selected · No limit</span>
          </div>
          <div className="history-options">
            {regionsList.map((region) => {
              const rows = result.known.filter((s) => s.region === region.code);
              const name = regionName({ name: (region as { city?: string }).city || region.name, region: region.code }, data, regions);
              const text = [name, ...rows.map((s) => presentation(s, result.known, data, regions).label)].join(' ').toLowerCase();
              const hidden = !text.includes(query);
              if (!hidden) visibleGroups++;
              return (
                <div key={region.code} className="history-region-group" data-history-search-text={text} hidden={hidden}>
                  <div className="history-region-name">{name}</div>
                  {rows.length ? (
                    rows.map((s) => {
                      const display = presentation(s, result.known, data, regions);
                      return (
                        <label key={s.id} className="history-zone-row">
                          <input type="checkbox" aria-label={display.label} data-region-id={s.id} checked={state.selected.includes(s.id)} onChange={(e) => update({ selected: e.target.checked ? [...new Set([...state.selected, s.id])] : state.selected.filter((v) => v !== s.id), initialized: true })} />
                          <span>{display.description || display.name}</span>
                        </label>
                      );
                    })
                  ) : (
                    <div className="history-region-empty">No recorded prices for this configuration</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="history-picker-empty" hidden={visibleGroups > 0}>No matching regions.</div>
          <div className="history-picker-notice">Different hardware configurations remain separate. Missing prices are never estimated.</div>
        </section>
      ) : null}
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
        {picker}
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
      {picker}
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
            <i style={{ ['--series-color' as string]: s.color, ...(metrics.length === 1 && s.dash ? { borderTopStyle: 'dashed' } : {}) }} />
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
            <button key={m} type="button" className={`history-metric-chip${activeMetric === m ? ' primary' : ''}`} data-metric-focus={m} aria-pressed={state.metricFocus === m} title={`Focus ${METRIC_SHORT[m].toLowerCase()} prices`} onClick={() => update({ metricFocus: state.metricFocus === m ? null : m })} onPointerEnter={() => setActiveFocus({ id: null, metric: m })} onFocus={() => setActiveFocus({ id: null, metric: m })} onBlur={() => setActiveFocus({ id: null, metric: null })}>
              <svg viewBox="0 0 28 10" aria-hidden="true"><line x1="1" x2="27" y1="5" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={METRIC_DASH[m]} strokeLinecap="round" /></svg>
              {METRIC_SHORT[m]}
            </button>
          ))}
          <small>Color identifies region · Line style identifies metric</small>
        </div>
      ) : null}
      <div className="history-range">
        <span>{dateLabel(geo.from)} – {dateLabel(geo.to)}</span>
        <span>{geo.series.length} curves · {metricText(S)} price</span>
      </div>
      <div className="history-plot regional-price-plot">
        <svg viewBox={`0 0 ${geo.w} ${geo.h}`} role="img" aria-label={`${S.model} regional ${metricText(S).toLowerCase()} prices`} onPointerMove={onMove}>
          {geo.grid.map((g, i) => (
            <g key={i}>
              <line x1={geo.left} x2={geo.w - geo.right} y1={g.y} y2={g.y} stroke="#e3ebe5" strokeDasharray="4 7" />
              <text x={geo.w - geo.right + 10} y={g.y + 4} className="history-axis">{g.label}</text>
            </g>
          ))}
          {geo.series.map((s) => {
            const style = lineStyle(s);
            return (
              <g key={s.id + s.metric} data-region-line={s.id} data-price-metric={s.metric} style={{ opacity: style.opacity }}>
                <path d={seriesPath(s, geo.gap)} fill="none" stroke={s.color} strokeWidth={style.strokeWidth} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
                {seriesDots(s, geo.gap).map((p) => <circle key={p.timestamp} cx={p.x} cy={p.y} r="3" fill={s.color} />)}
              </g>
            );
          })}
          {geo.ticks.map((time, i) => (
            <text key={time} className="history-axis" x={geo.series.length && geo.from === geo.to ? (geo.left + geo.w - geo.right) / 2 : geo.left + ((time - geo.from) / (geo.to - geo.from || 1)) * (geo.w - geo.left - geo.right)} y={geo.h - 12} textAnchor={i === 0 ? 'start' : i === geo.ticks.length - 1 ? 'end' : 'middle'}>
              {dateLabel(time)}
            </text>
          ))}
          <g className="history-hover" visibility={hover ? 'visible' : 'hidden'}>
            <line y1={geo.top} y2={geo.h - geo.bottom} x1={hover?.point.x ?? 0} x2={hover?.point.x ?? 0} stroke="#8aa48f" strokeDasharray="3 5" />
            <circle r="4" fill="white" strokeWidth="2" cx={hover?.point.x ?? 0} cy={hover?.point.y ?? 0} stroke={hover?.series.color} />
          </g>
        </svg>
        <div className="history-tooltip" hidden={!hover} style={hover ? { left: hover.left + 'px', top: '12px' } : undefined}>
          {hover ? (
            <>
              <strong>{moneyShort(hover.point.value)} <small>/ GPU-hour</small></strong>
              <span>{hover.series.display.name} · {METRIC_SHORT[hover.series.metric]}</span>
              {hover.series.display.description ? <span>{hover.series.display.description}</span> : null}
              <div>Low {moneyShort(hover.point.min)} · Average {moneyShort(hover.point.avg)} · High {moneyShort(hover.point.max)}</div>
              <time>{timeLabel(hover.point.time, geo.daily)}</time>
            </>
          ) : null}
        </div>
      </div>
      <div className="history-footnote">
        <span>Actual {metricText(S).toLowerCase()} observations · Missing dates remain gaps</span>
        <span>{snapshot}</span>
      </div>
      <details className="regional-method">
        <summary>Price methodology</summary>
        <p>{data.meta?.aggregation || 'Recorded prices for comparable configurations.'} {data.meta?.missingDataPolicy || ''} All prices use USD / GPU-hour; quotes confirm capacity.</p>
      </details>
      <details className="history-comparison regional-table">
        <summary>View {geo.series.length} regional price series</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>REGION / CONFIGURATION</th>
                {metrics.length > 1 ? <th>METRIC</th> : null}
                <th>LAST {metrics.length === 1 ? METRIC_SHORT[metric].toUpperCase() : 'PRICE'}</th>
                <th>PERIOD CHANGE</th>
                <th>RECORDED RANGE</th>
                <th>OBSERVATIONS</th>
              </tr>
            </thead>
            <tbody>
              {geo.series.map((s) => {
                const first = s.points[0];
                const last = s.points[s.points.length - 1];
                const change = s.points.length > 1 && first.value > 0 ? (last.value / first.value - 1) * 100 : null;
                return (
                  <tr key={s.id + s.metric}>
                    <td><i style={{ background: s.color }} /><strong>{s.display.name}</strong>{s.display.description ? <small>{s.display.description}</small> : null}</td>
                    {metrics.length > 1 ? <td>{METRIC_SHORT[s.metric]}</td> : null}
                    <td>{moneyShort(last.value)}<small>{dateLabel(last.time)}</small></td>
                    <td>{change === null ? '—' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%'}</td>
                    <td>{moneyShort(Math.min(...s.points.map((p) => p.value)))} – {moneyShort(Math.max(...s.points.map((p) => p.value)))}</td>
                    <td>{s.points.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
