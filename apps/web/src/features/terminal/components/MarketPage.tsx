'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import {
  CATALOG,
  METRIC_SHORT,
  offersFor,
  primaryMetric,
  regionalHistoryQuery,
  type Offer,
} from '@/features/market/catalog';
import { marketKeys, usePrices, useRegionalHistory, useRegions } from '@/features/market/hooks';
import {
  dateLabel,
  selectionKey,
  summary as historySummary,
} from '@/features/market/regional-history';
import { useHistoryChoices } from '@/features/market/history-choices';
import { emptyChoice } from '@/features/market/regional-history';
import {
  RegionalHistoryChart,
  type PriceHoverDetail,
} from '@/features/market/RegionalHistoryChart';
import { NewsSection } from '@/features/market/NewsSection';
import '@/features/market/capacity-chart.css';
import { useTerminal } from '../context';
import { useWorkspaceStore } from '../store';
import { Comparison } from './Comparison';
import { Filters } from './Filters';
import { hasMatchesPanel, Matches, renderMatchesPanel } from './Matches';
import { TButton } from './ui';
import { useAgentHints } from './AgentDrawer';

/** Other features may replace the comparison table (legacy `OpenNEXTProcurement.listingTable`). */
let listingTableSlot: ((offers: Offer[]) => ReactNode) | null = null;
export function registerListingTable(render: ((offers: Offer[]) => ReactNode) | null) {
  listingTableSlot = render;
}

/** Current offers for the selected filters; also indexes them for modals. */
export function useCurrentOffers(): Offer[] {
  const prices = usePrices();
  const regions = useRegions();
  const { model, region, term, count } = useWorkspaceStore();
  const indexOffers = useWorkspaceStore((s) => s.indexOffers);
  const offers = useMemo(
    () => offersFor(prices.data?.records || [], { model, region, term, count }, regions),
    [prices.data, model, region, term, count, regions],
  );
  useMemo(() => offers.length && indexOffers(offers), [offers, indexOffers]);
  return offers;
}

export function useRefreshPrices() {
  const client = useQueryClient();
  const toast = useToast();
  return useCallback(async () => {
    await client.invalidateQueries({ queryKey: ['market', 'regional-history'] });
    try {
      await client.refetchQueries({ queryKey: marketKeys.prices }, { throwOnError: true });
      toast('Latest collected prices loaded');
    } catch {
      toast('Price API unavailable; cached observations retained');
    }
  }, [client, toast]);
}

/** GPU Market page: filters, same-offering history chart, comparison, news and matches. */
export function MarketPage() {
  const state = useWorkspaceStore();
  const regions = useRegions();
  const toast = useToast();
  const { openModal } = useTerminal();
  const offers = useCurrentOffers();
  const refreshPrices = useRefreshPrices();
  const m = CATALOG.find((x) => x.name === state.model) || CATALOG[0];
  const selection = useMemo(
    () => ({
      model: state.model,
      region: state.region,
      count: state.count,
      period: state.period,
      term: state.term,
      priceMetric: state.priceMetric,
      priceMetrics: state.priceMetrics,
    }),
    [
      state.model,
      state.region,
      state.count,
      state.period,
      state.term,
      state.priceMetric,
      state.priceMetrics,
    ],
  );
  const query = regionalHistoryQuery(selection, regions);
  const history = useRegionalHistory(query);
  const choice = useHistoryChoices((s) => s.map[selectionKey(selection)]) || emptyChoice();
  const info = history.data ? historySummary(selection, history.data, choice, regions) : null;
  const { suggest } = useAgentHints();
  const onHover = useCallback(
    (detail: PriceHoverDetail) => suggest({ kind: 'chart', ...detail }),
    [suggest],
  );
  const term = history.data?.term || state.term || 'Spot';
  const onPeriod = (value: string) => {
    if (['6M', '1Y', 'ALL'].includes(value)) return openModal('history-access');
    if (['1D', '3D', '1W', '1M', '3M'].includes(value)) state.setPeriod(value);
  };
  const save = (o: Offer) => toast(state.toggleSaved(o) ? 'Capacity saved' : 'Removed from saved');
  const cart = (o: Offer) =>
    toast(state.addToCart(o) ? 'Added to quote cart' : 'Already in your quote cart');
  const quote = (o: Offer) => {
    if (state.role === 'Seller') {
      const requirement = {
        id: 'DEMAND-' + o.id,
        model: o.model,
        count: o.count,
        region: o.region,
        term: o.term,
        hours: 72,
        budget: o.price,
      };
      if (state.review.status !== 'Approved') {
        state.patch({ afterReview: { type: 'respond', requirement } });
        openModal('review');
      } else openModal('respond', { requirement });
    } else openModal('rfq-form', { offer: o });
  };
  const newRfq = () => {
    if (state.role === 'Seller') return toast('Switch to Buyer to post an RFQ.');
    openModal('rfq-form');
  };
  const newSupply = () => {
    if (state.review.status !== 'Approved') {
      state.patch({ afterReview: 'supply-form' });
      openModal('review');
    } else openModal('supply-form');
  };
  const chart = () => {
    if (history.isError && !history.data)
      return (
        <div className="aws-history-empty">
          <h3>Price service is temporarily unavailable</h3>
          <p>The chart will retry automatically. Existing observations are retained.</p>
        </div>
      );
    if (!history.data)
      return (
        <div className="aws-history-empty">
          <h3>Loading prices…</h3>
        </div>
      );
    return (
      <RegionalHistoryChart
        S={selection}
        data={history.data}
        regions={regions}
        onPeriod={onPeriod}
        onPriceHover={onHover}
      />
    );
  };
  return (
    <>
      <Filters onRefresh={() => void refreshPrices()} />
      <div className="workspace">
        <div>
          <div className="market-tabs">
            <span className="form-note">GPU market · research, compare and procure</span>
            <span className="gap" />
            <TButton
              cls="small"
              data-act={state.role === 'Seller' ? 'new-supply' : 'new-rfq'}
              onClick={state.role === 'Seller' ? newSupply : newRfq}
            >
              {state.role === 'Seller' ? 'List Supply' : 'Post RFQ'}
            </TButton>
          </div>
          <section className="market-panel">
            <div className="market-summary">
              <div className="market-name">
                <h2>{state.model}</h2>
                <p>
                  {m.memory} GB · {state.region} ·{' '}
                  {Number(state.count) === 0 ? 'Fractional GPU' : state.count + ' GPU'}
                </p>
              </div>
              <div className="metrics">
                <div className="metric">
                  <small id="marketPriceLabel">
                    {METRIC_SHORT[primaryMetric(selection)].toUpperCase()} {term.toUpperCase()} /
                    GPU-HR
                  </small>
                  <strong id="marketPrice">{info ? '$' + info.latest.toFixed(2) : '—'}</strong>
                  <span id="historyPrimaryCaption">
                    {info
                      ? info.region + ' · ' + dateLabel(info.last)
                      : history.data && choice.selected.length
                        ? 'No observations for the selected metric or period'
                        : history.data
                          ? 'Select regions to compare'
                          : 'Lowest observed reference'}
                  </span>
                </div>
                <div className="metric">
                  <small>OBSERVED CHANGE</small>
                  <strong
                    id="marketChange"
                    className={
                      info?.change == null ? '' : info.change >= 0 ? 'positive' : 'negative'
                    }
                  >
                    {info?.change == null
                      ? '—'
                      : (info.change >= 0 ? '+' : '') + info.change.toFixed(2) + '%'}
                  </strong>
                </div>
                <div className="metric">
                  <small>TIME POINTS</small>
                  <strong id="marketRecords">
                    {info ? info.points + ' observations' : history.data ? '0' : '—'}
                  </strong>
                </div>
              </div>
            </div>
            <section id="importedHistory" className="imported-history">
              {chart()}
            </section>
            <div className="chart-footer">
              <span>Spot / On-demand / Reserved · UTC · USD per GPU-hour</span>
              <button
                type="button"
                className="text-link"
                data-act="sources"
                onClick={() => openModal('sources')}
              >
                Methodology
              </button>
            </div>
            {listingTableSlot ? (
              listingTableSlot(offers)
            ) : (
              <Comparison
                offers={offers.slice(0, 3)}
                model={state.model}
                onSave={save}
                onCart={cart}
                onDetail={(o) => openModal('detail', { offer: o })}
              />
            )}
          </section>
          <NewsSection />
        </div>
        <aside className="side-stack">
          {hasMatchesPanel() ? (
            <>
              {renderMatchesPanel('best')}
              {renderMatchesPanel('recent')}
            </>
          ) : (
            <>
              <Matches
                kind="best"
                offers={offers}
                onQuote={quote}
                onRefresh={() => {
                  state.bumpMatchOffset();
                  toast('Matched resources refreshed');
                }}
              />
              <Matches
                kind="recent"
                offers={offers}
                onQuote={quote}
                onRefresh={() => {
                  state.bumpMatchOffset();
                  toast('Matched resources refreshed');
                }}
              />
            </>
          )}
        </aside>
      </div>
    </>
  );
}
