'use client';

import { useEffect, useRef } from 'react';
import { METRIC_LABELS, useRegions } from '@/features/market';
import { useInvalidateWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { FilterMenu, FilterType, MetricMenu } from './filter-menus';
import { MarketSwitcher } from './market-switcher';

/** GPU / Region / Price metrics / Market terms / GPU count filter bar with the live source indicator. */
export function Filters({ onRefresh }: { onRefresh: () => void }) {
  const regions = useRegions();
  const state = useWorkspaceStore();
  const invalidate = useInvalidateWorkspace();
  const wrap = useRef<HTMLElement>(null);
  const menu = state.menu;
  const filterType = (['model', 'region', 'priceMetric', 'term', 'count'] as FilterType[]).includes(
    menu as FilterType,
  )
    ? (menu as FilterType)
    : null;
  useEffect(() => {
    if (!menu) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.filter-wrap')) state.setMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const restore =
        menu === 'market-switch'
          ? '[data-act="market-menu"]'
          : menu === 'priceMetric'
            ? '[data-act="filter"][data-type="priceMetric"]'
            : null;
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
  const metricSummary =
    state.priceMetrics.length === 1
      ? METRIC_LABELS[state.priceMetrics[0] ?? 'avg']
      : state.priceMetrics.length + ' selected';
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
            title={
              type === 'priceMetric'
                ? state.priceMetrics.map((m) => METRIC_LABELS[m]).join(', ')
                : undefined
            }
            onClick={() => state.setMenu(menu === type ? null : type)}
          >
            <small>{label}</small>
            <strong>
              {type === 'count' && Number(value) === 0 ? 'Fractional' : String(value)}
            </strong>
            <span className="chevron">⌄</span>
          </button>
          {filterType === type ? (
            type === 'priceMetric' ? (
              <MetricMenu
                onDone={() => {
                  state.setMenu(null);
                  (
                    document.querySelector(
                      '[data-act="filter"][data-type="priceMetric"]',
                    ) as HTMLElement | null
                  )?.focus();
                }}
              />
            ) : (
              <FilterMenu
                type={type}
                regions={regions}
                onSelect={(v) => {
                  state.setFilter(type, v);
                  if (type === 'model' || type === 'region') void invalidate();
                }}
              />
            )
          ) : null}
        </div>
      ))}
      <div className="live">
        <i className="live-dot" />
        SOURCE FEED{' '}
        <button
          type="button"
          className="icon-btn"
          data-act="refresh-prices"
          aria-label="Refresh provider prices"
          title="Refresh provider prices"
          onClick={onRefresh}
        >
          ↻
        </button>
      </div>
    </section>
  );
}
