'use client';

import { useEffect, useMemo, useRef } from 'react';
import { LucideIcon } from '@/components/icons/lucide';
import { useToast } from '@/components/ui/toast';
import { useOpenModal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { useOpenQuoteRequest } from '@/features/quotes/hooks';
import {
  filteredRows,
  GROUPS,
  offerFor,
  paginate,
  selectedCount,
  SORTS,
  TERMS,
  type SpotRow,
} from '../inventory';
import { useSpotCheckout, useSpotInventory, usePrunedSelections } from '../hooks';
import { useSpotMarketStore } from '../store';
import { FilterGroup, PriceFilter } from './Filters';
import { CardView, TableView } from './Listings';
import '../spot-market.css';

/** Buyer GPU Market page (legacy `OpenNEXTSpotMarket.render`). */
export function SpotMarketPage() {
  const ui = useSpotMarketStore();
  const inventory = useSpotInventory();
  const checkout = useSpotCheckout(inventory);
  const openModal = useOpenModal();
  const toast = useToast();
  const role = useWorkspaceStore((s) => s.role);
  const modal = useWorkspaceStore((s) => s.modal);
  const root = useRef<HTMLElement>(null);
  const openQuoteRequest = useOpenQuoteRequest();
  const allRows = inventory.rows;
  usePrunedSelections(allRows);
  const filtered = useMemo(() => filteredRows(allRows, ui), [allRows, ui]);
  const { pages, page, visible, rangeStart, rangeEnd } = paginate(filtered, ui.page);
  useEffect(() => {
    if (page !== ui.page) ui.setPage(page);
  }, [page, ui]);

  const actions = {
    onBuy: (row: SpotRow) => {
      const current = allRows.find((item) => item._key === row._key);
      if (!current || current.term !== 'Spot')
        return toast('This Spot offer is no longer available in the preview.');
      checkout.beginCheckout(current);
    },
    onQuote: (row: SpotRow) => {
      const current = allRows.find((item) => item._key === row._key);
      if (!current) return toast('This offer is no longer available.');
      openQuoteRequest(offerFor(current));
    },
  };
  const newRfq = () => {
    if (role === 'Seller') return toast('Switch to Buyer to post an RFQ.');
    openModal('rfq-form');
  };
  const count = selectedCount(ui);
  return (
    <section
      ref={root}
      className="onx-spot-market"
      data-spot-market
      data-source-kind={inventory.kind}
    >
      <div className="onx-spot-market-head">
        <div>
          <span className="eyebrow">AI CAPACITY MARKET</span>
          <h1>GPU Market</h1>
        </div>
        <div className="onx-spot-market-actions">
          <div className="onx-spot-tabs" role="tablist" aria-label="GPU market terms">
            {TERMS.map((term) => (
              <button
                key={term}
                type="button"
                role="tab"
                data-spot-term={term}
                aria-selected={ui.term === term}
                className={ui.term === term ? 'active' : ''}
                onClick={() => ui.setTerm(term)}
              >
                {term}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn small onx-spot-post-rfq"
            data-act="new-rfq"
            onClick={newRfq}
          >
            Post RFQ
          </button>
        </div>
      </div>
      <div className="onx-spot-toolbar">
        <button
          type="button"
          className="btn secondary small"
          data-spot-toggle-filters
          aria-expanded={ui.showFilters}
          onClick={ui.toggleFilters}
        >
          <LucideIcon name="sliders-horizontal" />
          Filters{count ? ' · ' + count : ''}
        </button>
        <span className="onx-spot-result-count" role="status">
          {filtered.length} offer{filtered.length === 1 ? '' : 's'} · {ui.term}
        </span>
        <select
          className="field"
          data-spot-sort
          aria-label="Sort offers"
          value={ui.sort}
          onChange={(event) => ui.setSort(event.target.value)}
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="onx-spot-view">
          <button
            type="button"
            className={`icon-btn ${ui.view === 'list' ? 'selected' : ''}`}
            data-spot-view="list"
            aria-label="List view"
            aria-pressed={ui.view === 'list'}
            onClick={() => ui.setView('list')}
          >
            <LucideIcon name="list" />
          </button>
          <button
            type="button"
            className={`icon-btn ${ui.view === 'cards' ? 'selected' : ''}`}
            data-spot-view="cards"
            aria-label="Card view"
            aria-pressed={ui.view === 'cards'}
            onClick={() => ui.setView('cards')}
          >
            <LucideIcon name="layout-grid" />
          </button>
        </div>
      </div>
      <div className={`onx-spot-layout ${ui.showFilters ? '' : 'filters-hidden'}`}>
        <aside className="onx-spot-filters" hidden={!ui.showFilters} aria-label="Offer filters">
          <div className="onx-spot-filter-head">
            <strong>Filter offers</strong>
            <button type="button" data-spot-reset onClick={ui.reset}>
              Reset
            </button>
          </div>
          {GROUPS.slice(0, 2).map((group) => (
            <FilterGroup key={group.key} group={group} rows={allRows} />
          ))}
          <PriceFilter rows={allRows} />
          {GROUPS.slice(2).map((group) => (
            <FilterGroup key={group.key} group={group} rows={allRows} />
          ))}
        </aside>
        <section className="onx-spot-results" aria-label={`${ui.term} GPU offers`}>
          {ui.view === 'list' ? (
            <TableView rows={visible} actions={actions} />
          ) : (
            <CardView rows={visible} actions={actions} />
          )}
          <footer className="onx-spot-pagination">
            <span>
              {rangeStart}–{rangeEnd} of {filtered.length} offers
            </span>
            <div>
              <button
                type="button"
                className="icon-btn"
                data-spot-page="-1"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => ui.movePage(-1)}
              >
                <LucideIcon name="chevron-left" />
              </button>
              <span>
                {page + 1} / {pages}
              </span>
              <button
                type="button"
                className="icon-btn"
                data-spot-page="1"
                aria-label="Next page"
                disabled={page >= pages - 1}
                onClick={() => ui.movePage(1)}
              >
                <LucideIcon name="chevron-right" />
              </button>
            </div>
          </footer>
        </section>
      </div>
      {checkout.hasPending() && !modal ? (
        <button
          type="button"
          className="btn secondary small onx-spot-resume"
          data-act="spot-checkout-resume"
          onClick={() => checkout.action('spot-checkout-resume')}
        >
          Continue purchase
        </button>
      ) : null}
    </section>
  );
}
