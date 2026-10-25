'use client';

import { useEffect, useState } from 'react';
import {
  COLORS,
  chartWidth,
  num,
  seriesFor,
  usd,
  type Analytics,
  type BillingData,
} from '../analytics';
import { useBillingUi } from '../ui-store';
import { Btn } from './billing-ui';

function useViewportWidth() {
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth || 1440);
    update();
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

export function BillingChart({ billing, a }: { billing: BillingData; a: Analytics }) {
  const ui = useBillingUi();
  const series = seriesFor(billing.role);
  const visible = series.filter(([key]) => !ui.hidden.includes(key));
  const w = chartWidth(useViewportWidth());
  const h = 240,
    left = 70,
    right = 20,
    top = 20,
    bottom = 35,
    inner = w - left - right,
    ch = h - top - bottom;
  const bounds = a.rows.map((r) => {
    const values = visible.map(([key]) => num(r[key]));
    return ui.chart === 'bars'
      ? [
          values.reduce((sum, value) => sum + Math.min(0, value), 0),
          values.reduce((sum, value) => sum + Math.max(0, value), 0),
        ]
      : [Math.min(0, ...values), Math.max(0, ...values)];
  });
  const min = Math.min(0, ...bounds.map((b) => b[0]));
  const max = Math.max(1, ...bounds.map((b) => b[1]));
  const span = max - min;
  const y = (value: number) => top + ((max - value) / span) * ch;
  const zero = y(0);
  const step = inner / Math.max(1, a.rows.length);
  const bw = Math.max(1, Math.min(25, step * 0.62));
  const indexes = [
    ...new Set([
      0,
      Math.floor((a.rows.length - 1) / 3),
      Math.floor(((a.rows.length - 1) * 2) / 3),
      a.rows.length - 1,
    ]),
  ].filter((i) => i >= 0);
  const totalActivity = visible.reduce(
    (sum, [key]) => sum + a.rows.reduce((value, row) => value + Math.abs(row[key]), 0),
    0,
  );
  return (
    <section className="panel bill-chart-panel">
      <div className="bill-panel-head">
        <div>
          <h2>{billing.role === 'buyer' ? 'Compute spend' : 'Earnings over time'}</h2>
          <p>
            {a.sample
              ? 'Example analysis · not your balance or transaction history'
              : 'Posted account activity · USD · UTC'}
          </p>
        </div>
        <div className="bill-segment">
          <Btn
            act="bill-chart"
            value="bars"
            pressed={ui.chart === 'bars'}
            onClick={() => ui.patch({ chart: 'bars' })}
          >
            Bars
          </Btn>
          <Btn
            act="bill-chart"
            value="lines"
            pressed={ui.chart === 'lines'}
            onClick={() => ui.patch({ chart: 'lines' })}
          >
            Lines
          </Btn>
        </div>
      </div>
      <div className="bill-chart-legend">
        {series.map(([key, label]) => (
          <button
            key={key}
            className="bill-legend"
            type="button"
            data-act="bill-series"
            data-value={key}
            aria-pressed={!ui.hidden.includes(key)}
            onClick={() =>
              ui.toggleSeries(
                key,
                series.map(([k]) => k),
              )
            }
          >
            <i style={{ ['--series-color' as string]: COLORS[key] } as React.CSSProperties}></i>
            {label}
            <strong>{usd(a.sums[key])}</strong>
          </button>
        ))}
      </div>
      <div className="bill-svg-wrap">
        <svg
          className="bill-chart"
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`Daily financial activity from ${ui.from} to ${ui.to}`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const value = min + span * f;
            return (
              <g key={f}>
                <line x1={left} x2={w - right} y1={y(value)} y2={y(value)} stroke="#e8eee9" />
                <text x={left - 10} y={y(value) + 4} textAnchor="end">
                  {usd(value)}
                </text>
              </g>
            );
          })}
          <line
            data-bill-zero="true"
            x1={left}
            x2={w - right}
            y1={zero}
            y2={zero}
            stroke="#9bac9f"
            strokeWidth="1.2"
          />
          {ui.chart === 'bars'
            ? a.rows.map((r, i) => {
                let positive = 0;
                let negative = 0;
                return visible.map(([key, label]) => {
                  const value = num(r[key]);
                  const start = value < 0 ? negative : positive;
                  const end = start + value;
                  if (value < 0) negative = end;
                  else positive = end;
                  return (
                    <rect
                      key={key}
                      tabIndex={0}
                      role="img"
                      data-bill-series={key}
                      aria-label={`${r.day}, ${label}: ${usd(value)}`}
                      x={left + step * i + (step - bw) / 2}
                      y={Math.min(y(start), y(end))}
                      width={bw}
                      height={Math.abs(y(end) - y(start))}
                      rx="2"
                      fill={COLORS[key]}
                    >
                      <title>{`${r.day} · ${label} · ${usd(value)}`}</title>
                    </rect>
                  );
                });
              })
            : visible.map(([key, label]) => (
                <g key={key}>
                  <polyline
                    data-bill-series={key}
                    fill="none"
                    stroke={COLORS[key]}
                    strokeWidth="2"
                    points={a.rows
                      .map((r, i) => left + step * (i + 0.5) + ',' + y(r[key]))
                      .join(' ')}
                  />
                  {a.rows.map((r, i) => (
                    <circle
                      key={r.day}
                      tabIndex={0}
                      role="img"
                      aria-label={`${r.day}, ${label}: ${usd(r[key])}`}
                      cx={left + step * (i + 0.5)}
                      cy={y(r[key])}
                      r="3"
                      fill={COLORS[key]}
                    >
                      <title>{`${r.day} · ${label} · ${usd(r[key])}`}</title>
                    </circle>
                  ))}
                </g>
              ))}
          {indexes.map((i) => (
            <text key={i} x={left + step * (i + 0.5)} y={h - 10} textAnchor="middle">
              {new Date(a.rows[i].day).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                timeZone: 'UTC',
              })}
            </text>
          ))}
        </svg>
        {totalActivity === 0 ? (
          <div className="bill-chart-empty">No posted activity in this period</div>
        ) : null}
      </div>
      <p className="bill-footnote">
        {billing.role === 'buyer'
          ? 'Payments and posted usage charges are shown on their posting date. Prepaid orders are not a measure of actual GPU utilization.'
          : 'Net settlement earnings already include the OpenNEXT fee deduction. Broker commissions, if recorded, are separate expenses shown below zero. Only settled earnings are withdrawable.'}
      </p>
    </section>
  );
}
