'use client';

import { LucideIcon } from '@/components/icons';
import {
  optionCount,
  optionsFor,
  termFiltered,
  tradeModels,
  type FilterableRow,
  type GroupSpec,
} from '../settlements';
import { useSellerStore } from '../store';

export function FilterGroup({ group, rows }: { group: GroupSpec; rows: FilterableRow[] }) {
  const ui = useSellerStore();
  const selected = ui.selected[group.key];
  const query = group.searchable ? ui.search[group.key as 'model' | 'country'] || '' : '';
  const needle = query.trim().toLowerCase();
  const options = optionsFor(group, rows, ui.term, ui.selected);
  const noneSelected = ui.emptyGroups.includes(group.key);
  const allSelected =
    !noneSelected && (!selected.length || options.every((value) => selected.includes(value)));
  const partiallySelected = !noneSelected && !allSelected && selected.length > 0;
  const matching = options.filter((value) => value.toLowerCase().includes(needle));
  const label = group.key === 'model' ? 'Index models' : group.label;
  return (
    <details
      className="onx-sa-filter-group"
      data-sa-group={group.key}
      open={ui.openGroups.includes(group.key)}
      onToggle={(event) => ui.setGroupOpen(group.key, event.currentTarget.open)}
    >
      <summary>
        {label}
        <span>{noneSelected ? 'None' : allSelected ? 'All' : selected.length + ' selected'}</span>
        <LucideIcon name="chevron-down" />
      </summary>
      <div className="onx-sa-filter-options">
        {group.key === 'model' ? (
          <p className="onx-sa-filter-scope">Index only. Multiple selections</p>
        ) : null}
        {group.searchable ? (
          <label className="onx-sa-search">
            <LucideIcon name="search" />
            <span className="onx-sa-sr-only">Search {group.label}</span>
            <input
              type="search"
              data-sa-search={group.key}
              value={query}
              placeholder={'Search ' + group.label.toLowerCase()}
              onChange={(event) =>
                ui.setSearch(group.key as 'model' | 'country', event.target.value)
              }
            />
          </label>
        ) : null}
        <label className="onx-sa-check">
          <input
            type="checkbox"
            data-sa-all={group.key}
            checked={allSelected && options.length > 0}
            ref={(input) => {
              if (input) input.indeterminate = partiallySelected;
            }}
            disabled={options.length === 0}
            onChange={(event) =>
              event.target.checked ? ui.clearGroup(group.key) : ui.selectGroup(group.key, [])
            }
          />
          <span>All</span>
          <small>{termFiltered(rows, ui.term).length}</small>
        </label>
        {options.map((value) => (
          <label
            key={value}
            className="onx-sa-check"
            data-sa-option-row={value.toLowerCase()}
            hidden={Boolean(needle) && !value.toLowerCase().includes(needle)}
          >
            <input
              type="checkbox"
              data-sa-option={group.key}
              value={value}
              checked={allSelected || selected.includes(value)}
              onChange={(event) => ui.toggleOption(group.key, value, event.target.checked, options)}
            />
            <span>
              {value}
              {group.suffix || ''}
            </span>
            <small>{optionCount(group, value, rows, ui.term, ui.selected, ui.emptyGroups)}</small>
          </label>
        ))}
        <p className="onx-sa-no-options" hidden={matching.length > 0}>
          No options found.
        </p>
      </div>
    </details>
  );
}

export function TradeModelFilter({ rows }: { rows: FilterableRow[] }) {
  const ui = useSellerStore();
  const models = tradeModels(rows);
  const query = ui.search.tradeModel.trim().toLowerCase();
  return (
    <details
      className="onx-sa-filter-group"
      data-sa-group="tradeModel"
      open={ui.openGroups.includes('tradeModel')}
      onToggle={(event) => ui.setGroupOpen('tradeModel', event.currentTarget.open)}
    >
      <summary>
        Trade model<span>{ui.tradeModel ? '1 selected' : 'No models'}</span>
        <LucideIcon name="chevron-down" />
      </summary>
      <div className="onx-sa-filter-options">
        <p className="onx-sa-filter-scope">Analytics &amp; Activities. Select one model</p>
        <label className="onx-sa-search">
          <LucideIcon name="search" />
          <span className="onx-sa-sr-only">Search trade models</span>
          <input
            type="search"
            data-sa-search="tradeModel"
            value={ui.search.tradeModel}
            placeholder="Search models"
            onChange={(event) => ui.setSearch('tradeModel', event.target.value)}
          />
        </label>
        <div role="radiogroup" aria-label="Analytics and Activities model">
          {models.map((model) => (
            <label
              key={model}
              className="onx-sa-check"
              data-sa-option-row={model.toLowerCase()}
              hidden={Boolean(query) && !model.toLowerCase().includes(query)}
            >
              <input
                type="radio"
                name="insight-trade-model"
                data-sa-trade-model
                value={model}
                checked={ui.tradeModel === model}
                onChange={(event) => {
                  if (event.target.checked && models.includes(model)) ui.setTradeModel(model);
                }}
              />
              <span>{model}</span>
            </label>
          ))}
        </div>
        <p
          className="onx-sa-no-options"
          hidden={models.some((model) => model.toLowerCase().includes(query))}
        >
          No options found.
        </p>
      </div>
    </details>
  );
}
