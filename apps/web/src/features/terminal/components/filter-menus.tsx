'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CATALOG, PRICE_METRICS, type PriceMetric, type Region } from '@/features/market';
import { useToast } from '@/components/ui/toast';
import { useWorkspaceStore } from '@/terminal-kit';

export type FilterType = 'model' | 'region' | 'priceMetric' | 'term' | 'count';

function optionsFor(type: FilterType, regions: Region[]): [string | number, string][] {
  switch (type) {
    case 'model':
      return CATALOG.map((m) => [m.name, `${m.memory} GB`]);
    case 'region':
      return [
        ['All regions', ''],
        ...regions.map((r) => [r.name, r.city === r.name ? '' : r.city] as [string, string]),
      ];
    case 'priceMetric':
      return [
        ['max', 'Highest price'],
        ['avg', 'Average price'],
        ['min', 'Lowest price'],
      ];
    case 'term':
      return [
        ['Spot', 'Interruptible'],
        ['On-demand', 'Flexible access'],
        ['Reserved', 'Commitment terms'],
      ];
    case 'count':
      return [1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 64, 72, 128, 256].map((n) => [
        n,
        `${n} GPU${n > 1 ? 's' : ''}`,
      ]);
  }
}

export function MetricMenu({ onDone }: { onDone: () => void }) {
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
                ref={
                  active && !priceMetrics.slice(0, i).some((m) => PRICE_METRICS.indexOf(m) < i)
                    ? first
                    : undefined
                }
                type="checkbox"
                data-price-metric={metric}
                aria-describedby="metric-selection-note"
                checked={active}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...priceMetrics, metric]
                    : priceMetrics.filter((v) => v !== metric);
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
      <button
        type="button"
        className="btn secondary small metric-done"
        data-act="metrics-done"
        onClick={onDone}
      >
        Done
      </button>
    </div>
  );
}

export function FilterMenu({
  type,
  regions,
  onSelect,
}: {
  type: Exclude<FilterType, 'priceMetric'>;
  regions: Region[];
  onSelect: (value: string | number) => void;
}) {
  const current = useWorkspaceStore((s) => s[type]);
  const [query, setQuery] = useState('');
  const searchable = type === 'model' || type === 'region' || type === 'count';
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const q = query.trim().toLowerCase();
  const options = optionsFor(type, regions).map(([v, sub]) => ({
    v,
    sub,
    hidden: q
      ? type === 'count' && /^\d+$/.test(q)
        ? Number(v) !== Number(q)
        : !`${v}${sub}`.toLowerCase().includes(q)
      : false,
  }));
  const visible = options.filter((o) => !o.hidden);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!['Enter', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const first = visible[0];
    if (!first) return;
    if (event.key === 'Enter') onSelect(first.v);
    else
      (
        event.currentTarget
          .closest('.select-menu')
          ?.querySelector('.option:not([hidden])') as HTMLElement | null
      )?.focus();
  };
  const placeholder =
    type === 'model'
      ? 'Search GPU model…'
      : type === 'region'
        ? 'Search region or location…'
        : 'Search GPU count…';
  const label =
    type === 'model'
      ? 'Search GPU model'
      : type === 'region'
        ? 'Search region'
        : 'Search GPU count';
  return (
    <div className="select-menu">
      {searchable ? (
        <input
          ref={input}
          type="search"
          id={`${type}Search`}
          data-filter-search={type}
          inputMode={type === 'count' ? 'numeric' : undefined}
          placeholder={placeholder}
          aria-label={label}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
      ) : null}
      <div className="options">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            className={`option ${String(current) === String(o.v) ? 'active' : ''}`}
            data-act="select-filter"
            data-type={type}
            data-value={String(o.v)}
            hidden={o.hidden}
            onClick={() => onSelect(o.v)}
          >
            <span>{String(o.v)}</span>
            <small>{o.sub}</small>
          </button>
        ))}
      </div>
      <div className="filter-empty" hidden={visible.length > 0}>
        No matching {type === 'count' ? 'GPU count' : type === 'region' ? 'region' : 'GPU model'}{' '}
        found.
      </div>
    </div>
  );
}
