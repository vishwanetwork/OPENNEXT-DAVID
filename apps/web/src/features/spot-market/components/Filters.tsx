'use client';

import { LucideIcon } from '@/components/icons/lucide';
import { boundsFor, optionCount, optionsFor, termRows, usd, type FilterGroupSpec, type SpotRow } from '../inventory';
import { useSpotMarketStore } from '../store';

export function FilterGroup({ group, rows }: { group: FilterGroupSpec; rows: SpotRow[] }) {
  const state = useSpotMarketStore();
  const selected = state.selected[group.key];
  const query = group.searchable ? state.search[group.key as 'model' | 'country'] || '' : '';
  const options = optionsFor(group, rows, state);
  const needle = query.trim().toLowerCase();
  const matching = options.filter((value) => value.toLowerCase().includes(needle));
  return (
    <details className="onx-spot-filter-group" data-spot-group={group.key} open={state.openGroups.includes(group.key)} onToggle={(event) => state.setGroupOpen(group.key, event.currentTarget.open)}>
      <summary>
        {group.label}
        <span>{selected.length ? selected.length + ' selected' : 'All'}</span>
        <LucideIcon name="chevron-down" />
      </summary>
      <div className="onx-spot-filter-options">
        {group.searchable ? (
          <label className="onx-spot-search">
            <LucideIcon name="search" />
            <span className="onx-spot-sr-only">Search {group.label}</span>
            <input type="search" data-spot-search={group.key} value={query} placeholder={'Search ' + group.label.toLowerCase()} onChange={(event) => state.setSearch(group.key as 'model' | 'country', event.target.value)} />
          </label>
        ) : null}
        <label className="onx-spot-check">
          <input type="checkbox" data-spot-all={group.key} checked={!selected.length} onChange={() => state.clearGroup(group.key)} />
          <span>All</span>
          <small>{termRows(rows, state.term).length}</small>
        </label>
        {options.map((value) => (
          <label key={value} className="onx-spot-check" data-spot-option-row={value.toLowerCase()} hidden={Boolean(needle) && !value.toLowerCase().includes(needle)}>
            <input type="checkbox" data-spot-option={group.key} value={value} checked={selected.includes(value)} onChange={(event) => state.toggleOption(group.key, value, event.target.checked)} />
            <span>{value}{group.suffix || ''}</span>
            <small>{optionCount(group, value, rows, state)}</small>
          </label>
        ))}
        <p className="onx-spot-no-options" hidden={matching.length > 0}>No options found.</p>
      </div>
    </details>
  );
}

export function PriceFilter({ rows }: { rows: SpotRow[] }) {
  const state = useSpotMarketStore();
  const bounds = boundsFor(rows, state);
  const available = bounds.min !== null && bounds.max !== null;
  const equal = available && Math.abs(bounds.max! - bounds.min!) < 0.005;
  const sliderValue = available ? Math.min(bounds.max!, Math.max(bounds.min!, state.maxPrice === null ? bounds.max! : state.maxPrice)) : 0;
  const rangeText = available ? usd(bounds.min) + (equal ? '' : '–' + usd(bounds.max)) : 'No prices';
  return (
    <details className="onx-spot-filter-group" data-spot-group="price" open={state.openGroups.includes('price')} onToggle={(event) => state.setGroupOpen('price', event.currentTarget.open)}>
      <summary>
        Price<span>{state.maxPrice === null ? 'All' : 'Up to ' + usd(state.maxPrice)}</span>
        <LucideIcon name="chevron-down" />
      </summary>
      <div className="onx-spot-filter-options">
        <label className="onx-spot-check">
          <input type="checkbox" data-spot-price-all checked={state.maxPrice === null} onChange={() => state.setMaxPrice(null)} />
          <span>All</span>
        </label>
        <label className="onx-spot-price-number">
          <span>Maximum price</span>
          <input
            type="number" min={0} step={0.01} inputMode="decimal" data-spot-price-number
            defaultValue={state.maxPrice === null ? '' : state.maxPrice.toFixed(2)} key={state.maxPrice === null ? 'all' : state.maxPrice}
            placeholder={available ? bounds.max!.toFixed(2) : 'No prices'} disabled={!available}
            onChange={(event) => {
              const value = event.target.value.trim() === '' ? null : Number(event.target.value);
              state.setMaxPrice(value === null || !Number.isFinite(value) || value < 0 ? null : Math.round(value * 100) / 100);
            }}
          />
          <small>USD/GPU-hour</small>
        </label>
        <div className="onx-spot-price-range">
          <div>
            <span>Available range</span>
            <output data-spot-price-output>{rangeText}</output>
          </div>
          <input type="range" data-spot-price-range min={available ? bounds.min!.toFixed(2) : '0'} max={available ? bounds.max!.toFixed(2) : '0'} step={0.01} value={sliderValue.toFixed(2)} disabled={!available || equal} aria-label="Maximum USD per GPU-hour" onChange={(event) => state.setMaxPrice(Math.round(Number(event.target.value) * 100) / 100)} />
        </div>
      </div>
    </details>
  );
}
