'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LucideIcon } from '@/components/icons/lucide';
import { useToast } from '@/components/ui/toast';
import { InsightIndex } from '@/features/market';
import {
  useOpenModal,
  useTerminal,
  useTerminalSlots,
  useWorkspaceData,
  useWorkspaceStore,
} from '@/terminal-kit';
import { useIndexFilterRows, useSettlements } from '../hooks';
import {
  ACTIVITY_SHOW_OPTIONS,
  bandLabel,
  formatTime,
  GROUPING_STEPS,
  GROUPS,
  integer,
  latestMatching,
  optionCount,
  optionsFor,
  PANELS,
  priceBands,
  pruneSelections,
  RANGES,
  recentWindow,
  selectedCount,
  stepLabel,
  synchronizeTradeModel,
  termFiltered,
  TERMS,
  tradeFiltered,
  tradeModels,
  usdCents,
  type FilterableRow,
  type GroupSpec,
  type Settlement,
} from '../settlements';
import { useSellerStore } from '../store';
import '../seller.css';

function FilterGroup({ group, rows }: { group: GroupSpec; rows: FilterableRow[] }) {
  const ui = useSellerStore();
  const selected = ui.selected[group.key];
  const query = group.searchable ? ui.search[group.key as 'model' | 'country'] || '' : '';
  const needle = query.trim().toLowerCase();
  const options = optionsFor(group, rows, ui.term, ui.selected);
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
        <span>{selected.length ? selected.length + ' selected' : 'All'}</span>
        <LucideIcon name="chevron-down" />
      </summary>
      <div className="onx-sa-filter-options">
        {group.key === 'model' ? (
          <p className="onx-sa-filter-scope">Index only · Multiple selections</p>
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
            checked={!selected.length}
            onChange={() => ui.clearGroup(group.key)}
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
              checked={selected.includes(value)}
              onChange={(event) => ui.toggleOption(group.key, value, event.target.checked)}
            />
            <span>
              {value}
              {group.suffix || ''}
            </span>
            <small>{optionCount(group, value, rows, ui.term, ui.selected)}</small>
          </label>
        ))}
        <p className="onx-sa-no-options" hidden={matching.length > 0}>
          No options found.
        </p>
      </div>
    </details>
  );
}

function TradeModelFilter({ rows }: { rows: FilterableRow[] }) {
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
        <p className="onx-sa-filter-scope">Analytics &amp; Activities · Select one model</p>
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

function AnalyticsPanel({ rows }: { rows: Settlement[] }) {
  const ui = useSellerStore();
  const stats = priceBands(rows, ui.groupingStepCents);
  return (
    <section className="onx-sa-panel onx-sa-analytics" aria-labelledby="onx-sa-analytics-title">
      <header className="onx-sa-panel-head">
        <div>
          <h2 id="onx-sa-analytics-title">Analytics</h2>
          <span className="onx-sa-panel-model">{ui.tradeModel || 'No model available'}</span>
        </div>
        <span className="onx-sa-price-unit">USD / GPU-hour</span>
      </header>
      <div className="onx-sa-metrics">
        <div>
          <small>COMPLETED TRADES</small>
          <strong>{integer(stats.trades)}</strong>
        </div>
        <div>
          <small>TRADED GPUs</small>
          <strong>{integer(stats.totalGpus)}</strong>
        </div>
        <div>
          <small>GPU-WEIGHTED AVG.</small>
          <strong>
            {stats.weightedAverageCents === null ? '—' : usdCents(stats.weightedAverageCents)}
          </strong>
        </div>
      </div>
      <div className="onx-sa-band-toolbar">
        <span>Band size</span>
        <div role="group" aria-label="Executed price band size">
          {GROUPING_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              data-sa-step={step}
              className={ui.groupingStepCents === step ? 'active' : ''}
              aria-pressed={ui.groupingStepCents === step}
              onClick={() => ui.setStep(step)}
            >
              {stepLabel(step)}
            </button>
          ))}
        </div>
        <span className="onx-sa-concentration">
          Largest band · {(stats.topShare * 100).toFixed(1)}% of GPUs
        </span>
      </div>
      <div className="onx-sa-band-head" aria-hidden="true">
        <span>Executed band</span>
        <span>GPU concentration</span>
        <span>Trades</span>
        <span>GPUs</span>
      </div>
      <div className="onx-sa-band-list">
        {stats.bands.length ? (
          stats.bands.map((band) => {
            const label = bandLabel(band.lowerCents, ui.groupingStepCents);
            return (
              <div key={band.lowerCents} className="onx-sa-band-row">
                <div className="onx-sa-band-price">
                  <strong>{label.short}</strong>
                  <small>{label.range === label.short ? 'Exact cent' : label.range}</small>
                </div>
                <div className="onx-sa-depth">
                  <span style={{ width: Math.max(2, band.relative * 100).toFixed(2) + '%' }} />
                  <b>{(band.share * 100).toFixed(1)}%</b>
                </div>
                <strong className="onx-sa-band-number">{integer(band.trades)}</strong>
                <strong className="onx-sa-band-number">{integer(band.gpus)}</strong>
              </div>
            );
          })
        ) : (
          <div className="onx-sa-empty">
            <strong>No completed trades in the selected range</strong>
            <span>Adjust the filters, range or market term.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ActivitiesPanel({ rows }: { rows: Settlement[] }) {
  const ui = useSellerStore();
  const latest = latestMatching(rows, ui.activityShow);
  return (
    <section className="onx-sa-panel onx-sa-activities" aria-labelledby="onx-sa-activities-title">
      <header className="onx-sa-panel-head">
        <div>
          <h2 id="onx-sa-activities-title">Activities</h2>
          <span className="onx-sa-panel-model">{ui.tradeModel || 'No model available'}</span>
        </div>
        <label className="onx-sa-show-control">
          <span>Show</span>
          <select
            data-sa-show
            aria-label="Show activities"
            value={String(ui.activityShow)}
            onChange={(event) => ui.setActivityShow(event.target.value)}
          >
            {ACTIVITY_SHOW_OPTIONS.map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="onx-sa-activity-head" aria-hidden="true">
        <span>Price</span>
        <span>Model / Country</span>
        <span>Capacity / Term</span>
        <span>Time / Order ID</span>
      </div>
      <div className="onx-sa-activity-list">
        {latest.length ? (
          latest.map((row) => (
            <article key={row._key} className="onx-sa-activity-row">
              <div className="onx-sa-activity-price">
                <strong>{usdCents(row.priceCents)}</strong>
                <small>USD/GPU-hour</small>
              </div>
              <div>
                <strong>{row.model}</strong>
                <small>{row.country}</small>
              </div>
              <div>
                <strong>
                  {integer(row.gpuCount)} GPU{row.gpuCount === 1 ? '' : 's'}
                </strong>
                <small>
                  {row.term}
                  {row.vcpu === null ? '' : ' · ' + integer(row.vcpu) + ' vCPU'}
                  {row.memory === null ? '' : ' · ' + row.memory + ' GB/GPU'}
                </small>
              </div>
              <div>
                <time dateTime={row.settledAt}>{formatTime(row.settledAtTime)}</time>
                <code>{row.id}</code>
              </div>
            </article>
          ))
        ) : (
          <div className="onx-sa-empty">
            <strong>No completed activities match</strong>
            <span>Adjust the filters or choose another market term.</span>
          </div>
        )}
      </div>
      <footer className="onx-sa-panel-foot">
        <span>
          Showing {latest.length} of {rows.length} in the selected range
        </span>
        <button type="button" className="text-link" data-sa-history onClick={ui.openHistory}>
          Request older activity
        </button>
      </footer>
    </section>
  );
}

function HistoryModal() {
  const { openContact } = useTerminalSlots();
  const ui = useSellerStore();
  const dialog = useRef<HTMLElement>(null);
  const gated = ui.modal === 'range-gate';
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    requestAnimationFrame(() =>
      node
        .querySelector<HTMLButtonElement>('[data-sa-modal-close]')
        ?.focus({ preventScroll: true }),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        ui.closeHistory();
      } else if (event.key === 'Tab') {
        const focusable = [
          ...node.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [ui]);
  if (!ui.modal) return null;
  const contact = () => {
    ui.closeHistory();
    openContact({
      message:
        'I would like access to older anonymized GPU settlement activity and historical market data.',
    });
  };
  return (
    <div
      className="onx-sa-modal-overlay"
      data-sa-modal-overlay
      onMouseDown={(event) => event.target === event.currentTarget && ui.closeHistory()}
    >
      <section
        ref={dialog}
        className="onx-sa-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onx-sa-history-title"
        aria-describedby="onx-sa-history-copy"
      >
        <header>
          <div>
            <h2 id="onx-sa-history-title">
              {gated ? 'Historical data access' : 'Request older activity'}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            data-sa-modal-close
            aria-label="Close historical data dialog"
            onClick={ui.closeHistory}
          >
            ×
          </button>
        </header>
        <div className="onx-sa-modal-body">
          <p id="onx-sa-history-copy">
            {gated
              ? 'To view three months or more of historical data, please contact Sales.'
              : 'Up to the latest 100 settlements matching your current filters are available here. Contact Sales for additional history.'}
          </p>
          <footer>
            <button
              type="button"
              className="btn secondary"
              data-sa-modal-close
              onClick={ui.closeHistory}
            >
              Not now
            </button>
            <button type="button" className="btn" data-sa-contact onClick={contact}>
              Contact Sales
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

/** Wall-clock for the rolling windows; refreshed every minute instead of on every render. */
function useClock(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Market Insight page (legacy `OpenNEXTSellerActivities.render`): index, analytics and activities. */
export function SellerActivitiesPage() {
  const ui = useSellerStore();
  const role = useWorkspaceStore((s) => s.role);
  const review = useWorkspaceData().review;
  const patch = useWorkspaceStore((s) => s.patch);
  const openModal = useOpenModal();
  const { go } = useTerminal();
  const settlements = useSettlements();
  const indexRows = useIndexFilterRows();
  const now = useClock();
  const rows = useMemo(
    () => settlements.filter((row) => row.settledAtTime <= now),
    [settlements, now],
  );
  const filterRows = useMemo<FilterableRow[]>(() => [...rows, ...indexRows], [rows, indexRows]);
  // Selections and the trade model follow the available rows (legacy prune/synchronize on render).
  const { selected, setSelected, tradeModel, setTradeModel } = ui;
  useEffect(() => {
    const pruned = pruneSelections(selected, filterRows);
    if (JSON.stringify(pruned) !== JSON.stringify(selected)) setSelected(pruned);
    const next = synchronizeTradeModel(filterRows, tradeModel);
    if (next !== tradeModel) setTradeModel(next);
  }, [filterRows, selected, setSelected, tradeModel, setTradeModel]);
  const range = RANGES.find((item) => item.key === ui.range) || RANGES[2];
  const options = {
    range: range.key,
    days: range.days,
    term: ui.term,
    selected: Object.fromEntries(
      GROUPS.map((group) => [group.key, ui.selected[group.key].slice()]),
    ) as Record<'model' | 'country' | 'vcpu' | 'memory', string[]>,
  };
  const matching = tradeFiltered(rows, ui.term, ui.selected, ui.tradeModel);
  const windowed = recentWindow(matching, now, range.days);
  const visible = PANELS.filter((panel) => ui.panels.includes(panel));
  const count = selectedCount(ui.selected, ui.panels, ui.tradeModel);
  const listSupply = () => {
    if (review.status !== 'Approved') {
      patch({ afterReview: 'supply-form' });
      openModal('review');
    } else openModal('supply-form');
  };
  return (
    <section className="onx-seller-activities" data-seller-activities>
      <header className="onx-sa-page-head">
        <div>
          <h1>Market Insight</h1>
          <p>Market indexes, executed-price analytics and anonymized GPU capacity activity.</p>
        </div>
        {role === 'buyer' ? (
          <button
            type="button"
            className="btn onx-sa-list-supply"
            data-nav="market"
            onClick={() => go('market')}
          >
            Browse GPU Market
          </button>
        ) : (
          <button
            type="button"
            className="btn onx-sa-list-supply"
            data-act="new-supply"
            onClick={listSupply}
          >
            <LucideIcon name="plus" />
            List my supply
          </button>
        )}
      </header>
      <div className="onx-sa-termbar">
        <div className="onx-sa-tabs" role="tablist" aria-label="Market term">
          {TERMS.map((term) => (
            <button
              key={term}
              type="button"
              role="tab"
              data-sa-term={term}
              aria-selected={ui.term === term}
              className={ui.term === term ? 'active' : ''}
              onClick={() => ui.setTerm(term)}
            >
              {term === 'All' ? 'All terms' : term}
            </button>
          ))}
        </div>
      </div>
      <div className="onx-sa-toolbar">
        <button
          type="button"
          className="btn secondary small"
          data-sa-toggle-filters
          aria-expanded={ui.showFilters}
          onClick={ui.toggleFilters}
        >
          <LucideIcon name="sliders-horizontal" />
          Filters{count ? ' · ' + count : ''}
        </button>
        <div className="onx-sa-panel-controls" role="group" aria-label="Visible insight panels">
          {PANELS.map((panel) => {
            const active = ui.panels.includes(panel);
            const lastActive = active && ui.panels.length === 1;
            return (
              <button
                key={panel}
                type="button"
                data-sa-panel={panel}
                aria-pressed={active}
                className={active ? 'active' : ''}
                disabled={lastActive}
                aria-disabled={lastActive || undefined}
                onClick={() => ui.togglePanel(panel)}
              >
                <span className="onx-sa-panel-marker" aria-hidden="true">
                  {active ? '✓' : '+'}
                </span>
                {panel[0].toUpperCase() + panel.slice(1)}
              </button>
            );
          })}
        </div>
        <div className="onx-sa-ranges" role="group" aria-label="History range">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              data-sa-range={item.key}
              aria-pressed={ui.range === item.key}
              aria-haspopup={item.gated ? 'dialog' : undefined}
              className={ui.range === item.key ? 'active' : ''}
              onClick={() => ui.requestRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={`onx-sa-layout ${ui.showFilters ? '' : 'filters-hidden'}`}>
        <aside
          className="onx-sa-filters"
          hidden={!ui.showFilters}
          aria-label="Market insight filters"
        >
          <div className="onx-sa-filter-head">
            <strong>Filter market data</strong>
            <button type="button" data-sa-clear onClick={ui.clear}>
              Clear
            </button>
          </div>
          {visible.includes('index') ? <FilterGroup group={GROUPS[0]} rows={filterRows} /> : null}
          {visible.some((panel) => panel !== 'index') ? (
            <TradeModelFilter rows={filterRows} />
          ) : null}
          {GROUPS.slice(1).map((group) => (
            <FilterGroup key={group.key} group={group} rows={filterRows} />
          ))}
        </aside>
        <div
          className={`onx-sa-panels${visible.includes('index') ? ' has-index' : ''}${visible.length === 1 ? ' single-panel' : ''}`}
          data-visible-count={visible.length}
        >
          {visible.map((panel) =>
            panel === 'index' ? (
              <InsightIndex key="index" options={options} role={role} />
            ) : panel === 'analytics' ? (
              <AnalyticsPanel key="analytics" rows={windowed} />
            ) : (
              <ActivitiesPanel key="activities" rows={windowed} />
            ),
          )}
        </div>
      </div>
      <HistoryModal />
    </section>
  );
}
