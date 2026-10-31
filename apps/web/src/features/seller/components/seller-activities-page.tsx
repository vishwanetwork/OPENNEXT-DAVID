'use client';

import '../seller.css';
import { useEffect, useMemo, useState } from 'react';
import { LucideIcon } from '@/components/icons';
import { InsightIndex } from '@/features/market';
import { useOpenModal, useTerminal, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { useIndexFilterRows, useSettlements } from '../hooks';
import {
  GROUPS,
  PANELS,
  pruneSelections,
  RANGES,
  recentWindow,
  selectedCount,
  synchronizeTradeModel,
  TERMS,
  tradeFiltered,
  type FilterableRow,
} from '../settlements';
import { useSellerStore } from '../store';
import { FilterGroup, TradeModelFilter } from './filters';
import { ActivitiesPanel, AnalyticsPanel } from './panels';
import { HistoryModal } from './history-modal';

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
    emptyGroups: ui.emptyGroups,
    selected: Object.fromEntries(
      GROUPS.map((group) => [group.key, ui.selected[group.key].slice()]),
    ) as Record<'model' | 'country' | 'vcpu' | 'memory', string[]>,
  };
  const matching = tradeFiltered(rows, ui.term, ui.selected, ui.tradeModel, ui.emptyGroups);
  const windowed = recentWindow(matching, now, range.days);
  const visible = PANELS.filter((panel) => ui.panels.includes(panel));
  const count = selectedCount(ui.selected, ui.panels, ui.tradeModel, ui.emptyGroups);
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
          Filters{count ? ' (' + count + ')' : ''}
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
                {panel.charAt(0).toUpperCase() + panel.slice(1)}
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
