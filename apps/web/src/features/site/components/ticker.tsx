'use client';

import { useEffect, useRef, useState } from 'react';
import type { TickerRecord } from '@opennext/contracts';
import { dateUtc, money } from '@/lib/format';
import { useTickerHistory } from '../hooks';
import { sparkGeometry, tickerChange } from '../lib/ticker';

export function TickerSpark({ points }: { points: TickerRecord['points'] }) {
  const geometry = sparkGeometry(points || []);
  if (!geometry) return <p className="ticker-observation-note">Loading recorded price history…</p>;
  return (
    <>
      <svg className="spark" viewBox="0 0 370 90" role="img" aria-label={`Recorded price history, ${geometry.count} observations`}>
        <path d="M8 8H362 M8 45H362 M8 82H362" fill="none" stroke="#334035" strokeDasharray="3 5" />
        <path className="ticker-price-line" d={geometry.path} fill="none" stroke="#80d3a5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {geometry.dots.map((dot, i) => (
          <circle cx={dot.x} cy={dot.y} r="1.8" fill="#80d3a5" key={i} />
        ))}
        <circle cx={geometry.last.x} cy={geometry.last.y} r="3.5" fill="#80d3a5" />
      </svg>
      <div className="ticker-chart-dates">
        <span>{dateUtc(geometry.start)}</span>
        <span>{dateUtc(geometry.end)}</span>
      </div>
    </>
  );
}

/** One ticker frame: six fields in order plus the hover detail card (legacy `ticker()`). */
export function TickerView({ row, paused, onToggle }: { row: TickerRecord | undefined; paused: boolean; onToggle: () => void }) {
  const price = row?.perGpuHourly;
  const model = row?.gpuModel || 'GPU prices';
  const country = row?.country || '—';
  const term = row?.term || 'Spot';
  const values = row?.points || [];
  const vcpu = Number.isFinite(row?.vcpu) && (row?.vcpu as number) > 0 ? row?.vcpu + ' vCPU' : '— vCPU';
  const memory = Number.isFinite(row?.gpuMemoryGb) && (row?.gpuMemoryGb as number) > 0 ? row?.gpuMemoryGb + ' GB' : '— GB';
  const change = tickerChange(values);
  return (
    <section className="ticker" id="ticker" tabIndex={0} aria-label="GPU price ticker">
      <div className="ticker-row">
        <strong className="ticker-label">GPU MARKET</strong>
        <div className="ticker-entry">
          <strong data-ticker-field="country">{country}</strong>
          <strong data-ticker-field="model">{model}</strong>
          <span className="ticker-divider" data-ticker-field="vcpu">{vcpu}</span>
          <span className="ticker-divider" data-ticker-field="memory" title="Memory per GPU">{memory}</span>
          <span className="ticker-divider" data-ticker-field="price">{money(price)} / GPU-hour</span>
          <span className="ticker-divider" data-ticker-field="term">{term}</span>
        </div>
        <button type="button" className="ticker-control" data-act="ticker-pause" aria-label={`${paused ? 'Resume' : 'Pause'} market ticker`} onClick={onToggle}>
          {paused ? '▶' : 'Ⅱ'}
        </button>
      </div>
      <div className="ticker-detail">
        <div className="ticker-card-head">
          <div>
            <div className="eyebrow">{country} · {model} · {term}</div>
            <div className="ticker-price">{money(price)}</div>
          </div>
          <div className="ticker-chart-meta">
            <span className="tag">7D history</span>
            {change !== null ? (
              <strong className={change < 0 ? 'negative' : 'positive'}>{change > 0 ? '+' : ''}{change.toFixed(2)}%</strong>
            ) : null}
          </div>
        </div>
        <TickerSpark points={values} />
      </div>
    </section>
  );
}

/** Rotating GPU market ticker: advances every 4.2 s unless paused, hovered, focused or hidden. */
export function Ticker() {
  const { data: rows = [] } = useTickerHistory();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      const node = host.current?.firstElementChild;
      if (!node || paused || node.matches(':hover') || node.contains(document.activeElement) || document.hidden) return;
      setIndex((current) => current + 1);
    }, 4200);
    return () => clearInterval(timer);
  }, [paused]);
  const row = rows[index % Math.max(1, rows.length)];
  return (
    <div ref={host} style={{ display: 'contents' }}>
      <TickerView row={row} paused={paused} onToggle={() => setPaused((value) => !value)} />
    </div>
  );
}
