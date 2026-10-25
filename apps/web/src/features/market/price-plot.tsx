import type { PointerEvent as ReactPointerEvent } from 'react';
import { METRIC_SHORT, type PriceMetric } from './catalog';
import {
  dateLabel,
  metricText,
  moneyShort,
  seriesDots,
  seriesPath,
  timeLabel,
  type Geometry,
  type HistorySelection,
  type PlotPoint,
  type PlotSeries,
} from './regional-history';

export interface HoverState {
  series: PlotSeries;
  point: PlotPoint;
  left: number;
}

export interface LineStyle {
  opacity: number;
  strokeWidth: number;
}

/** The SVG price curves, axis grid, hover crosshair and tooltip. */
export function PricePlot({
  selection,
  geo,
  hover,
  lineStyle,
  onMove,
}: {
  selection: HistorySelection;
  geo: Geometry;
  hover: HoverState | null;
  lineStyle: (series: PlotSeries) => LineStyle;
  onMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
}) {
  return (
    <div className="history-plot regional-price-plot">
      <svg
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        role="img"
        aria-label={`${selection.model} regional ${metricText(selection).toLowerCase()} prices`}
        onPointerMove={onMove}
      >
        {geo.grid.map((g, i) => (
          <g key={i}>
            <line
              x1={geo.left}
              x2={geo.w - geo.right}
              y1={g.y}
              y2={g.y}
              stroke="#e3ebe5"
              strokeDasharray="4 7"
            />
            <text x={geo.w - geo.right + 10} y={g.y + 4} className="history-axis">
              {g.label}
            </text>
          </g>
        ))}
        {geo.series.map((s) => {
          const style = lineStyle(s);
          return (
            <g
              key={s.id + s.metric}
              data-region-line={s.id}
              data-price-metric={s.metric}
              style={{ opacity: style.opacity }}
            >
              <path
                d={seriesPath(s, geo.gap)}
                fill="none"
                stroke={s.color}
                strokeWidth={style.strokeWidth}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {seriesDots(s, geo.gap).map((p) => (
                <circle key={p.timestamp} cx={p.x} cy={p.y} r="3" fill={s.color} />
              ))}
            </g>
          );
        })}
        {geo.ticks.map((time, i) => (
          <text
            key={time}
            className="history-axis"
            x={
              geo.series.length && geo.from === geo.to
                ? (geo.left + geo.w - geo.right) / 2
                : geo.left +
                  ((time - geo.from) / (geo.to - geo.from || 1)) * (geo.w - geo.left - geo.right)
            }
            y={geo.h - 12}
            textAnchor={i === 0 ? 'start' : i === geo.ticks.length - 1 ? 'end' : 'middle'}
          >
            {dateLabel(time)}
          </text>
        ))}
        <g className="history-hover" visibility={hover ? 'visible' : 'hidden'}>
          <line
            y1={geo.top}
            y2={geo.h - geo.bottom}
            x1={hover?.point.x ?? 0}
            x2={hover?.point.x ?? 0}
            stroke="#8aa48f"
            strokeDasharray="3 5"
          />
          <circle
            r="4"
            fill="white"
            strokeWidth="2"
            cx={hover?.point.x ?? 0}
            cy={hover?.point.y ?? 0}
            stroke={hover?.series.color}
          />
        </g>
      </svg>
      <div
        className="history-tooltip"
        hidden={!hover}
        style={hover ? { left: hover.left + 'px', top: '12px' } : undefined}
      >
        {hover ? (
          <>
            <strong>
              {moneyShort(hover.point.value)} <small>/ GPU-hour</small>
            </strong>
            <span>
              {hover.series.display.name} · {METRIC_SHORT[hover.series.metric]}
            </span>
            {hover.series.display.description ? (
              <span>{hover.series.display.description}</span>
            ) : null}
            <div>
              Low {moneyShort(hover.point.min)} · Average {moneyShort(hover.point.avg)} · High{' '}
              {moneyShort(hover.point.max)}
            </div>
            <time>{timeLabel(hover.point.time, geo.daily)}</time>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Tabular view of every plotted series: last price, period change, recorded range. */
export function SeriesTable({
  geo,
  metrics,
  metric,
}: {
  geo: Geometry;
  metrics: readonly PriceMetric[];
  metric: PriceMetric;
}) {
  return (
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
              if (!first || !last) return null;
              const change =
                s.points.length > 1 && first.value > 0
                  ? (last.value / first.value - 1) * 100
                  : null;
              return (
                <tr key={s.id + s.metric}>
                  <td>
                    <i style={{ background: s.color }} />
                    <strong>{s.display.name}</strong>
                    {s.display.description ? <small>{s.display.description}</small> : null}
                  </td>
                  {metrics.length > 1 ? <td>{METRIC_SHORT[s.metric]}</td> : null}
                  <td>
                    {moneyShort(last.value)}
                    <small>{dateLabel(last.time)}</small>
                  </td>
                  <td>
                    {change === null ? '—' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%'}
                  </td>
                  <td>
                    {moneyShort(Math.min(...s.points.map((p) => p.value)))} –{' '}
                    {moneyShort(Math.max(...s.points.map((p) => p.value)))}
                  </td>
                  <td>{s.points.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
