'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CATALOG, METRIC_LABELS, PRICE_METRICS, type PriceMetric, type Region } from '@/features/market/catalog';
import { useRegions } from '@/features/market/hooks';
import { useToast } from '@/components/ui/toast';
import { useTerminal } from '../context';
import { useWorkspaceStore } from '../store';

type FilterType = 'model' | 'region' | 'priceMetric' | 'term' | 'count';

function optionsFor(type: FilterType, regions: Region[]): [string | number, string][] {
  switch (type) {
    case 'model':
      return CATALOG.map((m) => [m.name, `${m.memory} GB`]);
    case 'region':
      return [['All regions', ''], ...regions.map((r) => [r.name, r.city === r.name ? '' : r.city] as [string, string])];
    case 'priceMetric':
      return [['max', 'Highest price'], ['avg', 'Average price'], ['min', 'Lowest price']];
    case 'term':
      return [['Spot', 'Interruptible'], ['On-demand', 'Flexible access'], ['Reserved', 'Commitment terms']];
    case 'count':
      return [1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 64, 72, 128, 256].map((n) => [n, `${n} GPU${n > 1 ? 's' : ''}`]);
  }
}

/** Market switcher (GPU Market / Model Capacity) — Model Capacity is "Coming soon". */
export function MarketSwitcher() {
  const { route, go } = useTerminal();
  const menu = useWorkspaceStore((s) => s.menu);
  const setMenu = useWorkspaceStore((s) => s.setMenu);
  const selected = route === 'models' ? 'models' : 'market';
  const expanded = menu === 'market-switch';
  const button = useRef<HTMLButtonElement>(null);
  const checked = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (expanded) checked.current?.focus();
  }, [expanded]);
  return (
    <div className="filter-wrap market-switch-wrap">
      <button ref={button} type="button" className="market-switch-button" data-act="market-menu" aria-label="Switch Market" aria-haspopup="menu" aria-controls="market-switch-menu" aria-expanded={expanded} onClick={() => setMenu(expanded ? null : 'market-switch')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></svg>
        <span>Switch Market</span>
        <span className="chevron">⌄</span>
      </button>
      {expanded ? (
        <div className="select-menu market-switch-menu" id="market-switch-menu" role="menu" aria-label="Choose a market">
          {([['market', 'GPU Market', 'GPU rental and compute capacity', '◇'], ['models', 'Model Capacity', 'LLM access and token pricing', '◈']] as const).map(([target, label, description, icon]) => (
            <button
              key={target}
              ref={selected === target ? checked : undefined}
              type="button"
              className="market-option"
              role="menuitemradio"
              aria-checked={selected === target}
              disabled={target === 'models'}
              aria-disabled={target === 'models' ? 'true' : undefined}
              data-act={target === 'models' ? undefined : 'switch-market'}
              data-value={target === 'models' ? undefined : target}
              onClick={() => { if (target === 'market') { go('market'); button.current?.focus(); } }}
            >
              <span className="market-option-icon">{icon}</span>
              <span>
                <strong>{label}{target === 'models' ? <> <em className="market-coming-soon">Coming soon</em></> : null}</strong>
                <small>{description}</small>
              </span>
              <span className="market-option-check" aria-hidden="true">{selected === target ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricMenu({ onDone }: { onDone: () => void }) {
  const priceMetrics = useWorkspaceStore((s) => s.priceMetrics);
  const setPriceMetrics = useWorkspaceStore((s) => s.setPriceMetrics);
  const toast = useToast();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div className="select-menu metric-select-menu" id="price-metrics-menu">
      <fieldset>
        <legend>Compare price metrics</legend>
        <p id="metric-selection-note">Select one or more. Keep at least one selected.</p>
        {optionsFor('priceMetric', []).map(([value, label], i) => {
          const metric = value as PriceMetric;
          const active = priceMetrics.includes(metric);
          return (
            <label key={metric} className={`metric-option ${active ? 'active' : ''}`}>
              <input
                ref={active && !priceMetrics.slice(0, i).some((m) => PRICE_METRICS.indexOf(m) < i) ? first : undefined}
                type="checkbox"
                data-price-metric={metric}
                aria-describedby="metric-selection-note"
                checked={active}
                onChange={(e) => {
                  const next = e.target.checked ? [...priceMetrics, metric] : priceMetrics.filter((v) => v !== metric);
                  if (!next.length) {
                    toast('Keep at least one price metric selected.');
                    return;
                  }
                  setPriceMetrics(next);
                }}
              />
              <span>{label}</span>
              <i className={`metric-line metric-line-${metric}`} aria-hidden="true" />
            </label>
          );
        })}
      </fieldset>
      <button type="button" className="btn secondary small metric-done" data-act="metrics-done" onClick={onDone}>Done</button>
    </div>
  );
}

function FilterMenu({ type, regions, onSelect }: { type: Exclude<FilterType, 'priceMetric'>; regions: Region[]; onSelect: (value: string | number) => void }) {
  const current = useWorkspaceStore((s) => s[type]);
  const [query, setQuery] = useState('');
  const searchable = type === 'model' || type === 'region' || type === 'count';
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const q = query.trim().toLowerCase();
  const options = optionsFor(type, regions).map(([v, sub]) => ({ v, sub, hidden: q ? (type === 'count' && /^\d+$/.test(q) ? Number(v) !== Number(q) : !`${v}${sub}`.toLowerCase().includes(q)) : false }));
  const visible = options.filter((o) => !o.hidden);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!['Enter', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const first = visible[0];
    if (!first) return;
    if (event.key === 'Enter') onSelect(first.v);
    else (event.currentTarget.closest('.select-menu')?.querySelector('.option:not([hidden])') as HTMLElement | null)?.focus();
  };
  const placeholder = type === 'model' ? 'Search GPU model…' : type === 'region' ? 'Search region or location…' : 'Search GPU count…';
  const label = type === 'model' ? 'Search GPU model' : type === 'region' ? 'Search region' : 'Search GPU count';
  return (
    <div className="select-menu">
      {searchable ? <input ref={input} type="search" id={`${type}Search`} data-filter-search={type} inputMode={type === 'count' ? 'numeric' : undefined} placeholder={placeholder} aria-label={label} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} /> : null}
      <div className="options">
        {options.map((o) => (
          <button key={String(o.v)} type="button" className={`option ${String(current) === String(o.v) ? 'active' : ''}`} data-act="select-filter" data-type={type} data-value={String(o.v)} hidden={o.hidden} onClick={() => onSelect(o.v)}>
            <span>{String(o.v)}</span>
            <small>{o.sub}</small>
          </button>
        ))}
      </div>
      <div className="filter-empty" hidden={visible.length > 0}>No matching {type === 'count' ? 'GPU count' : type === 'region' ? 'region' : 'GPU model'} found.</div>
    </div>
  );
}

/** GPU / Region / Price metrics / Market terms / GPU count filter bar with the live source indicator. */
export function Filters({ onRefresh }: { onRefresh: () => void }) {
  const regions = useRegions();
  const state = useWorkspaceStore();
  const wrap = useRef<HTMLElement>(null);
  const menu = state.menu;
  const filterType = (['model', 'region', 'priceMetric', 'term', 'count'] as FilterType[]).includes(menu as FilterType) ? (menu as FilterType) : null;
  useEffect(() => {
    if (!menu) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.filter-wrap')) state.setMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const restore = menu === 'market-switch' ? '[data-act="market-menu"]' : menu === 'priceMetric' ? '[data-act="filter"][data-type="priceMetric"]' : null;
      state.setMenu(null);
      if (restore) (document.querySelector(restore) as HTMLElement | null)?.focus();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, state]);
  const metricSummary = state.priceMetrics.length === 1 ? METRIC_LABELS[state.priceMetrics[0]] : state.priceMetrics.length + ' selected';
  const rows: [FilterType, string, string | number][] = [
    ['model', 'GPU', state.model],
    ['region', 'Region', state.region],
    ['priceMetric', 'Price metrics', metricSummary],
    ['term', 'Market terms', state.term],
    ['count', 'GPU Count', state.count],
  ];
  return (
    <section ref={wrap} className="filters">
      <MarketSwitcher />
      {rows.map(([type, label, value]) => (
        <div key={type} className="filter-wrap">
          <button
            type="button"
            className="filter"
            data-act="filter"
            data-type={type}
            aria-expanded={menu === type}
            aria-controls={type === 'priceMetric' ? 'price-metrics-menu' : undefined}
            title={type === 'priceMetric' ? state.priceMetrics.map((m) => METRIC_LABELS[m]).join(', ') : undefined}
            onClick={() => state.setMenu(menu === type ? null : type)}
          >
            <small>{label}</small>
            <strong>{type === 'count' && Number(value) === 0 ? 'Fractional' : String(value)}</strong>
            <span className="chevron">⌄</span>
          </button>
          {filterType === type ? (
            type === 'priceMetric' ? (
              <MetricMenu onDone={() => { state.setMenu(null); (document.querySelector('[data-act="filter"][data-type="priceMetric"]') as HTMLElement | null)?.focus(); }} />
            ) : (
              <FilterMenu type={type} regions={regions} onSelect={(v) => { state.setFilter(type, v); if (type === 'model' || type === 'region') void import('../context').then((m) => m.refreshWorkspace()); }} />
            )
          ) : null}
        </div>
      ))}
      <div className="live">
        <i className="live-dot" />SOURCE FEED{' '}
        <button type="button" className="icon-btn" data-act="refresh-prices" aria-label="Refresh provider prices" title="Refresh provider prices" onClick={onRefresh}>↻</button>
      </div>
    </section>
  );
}
