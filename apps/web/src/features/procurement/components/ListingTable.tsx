'use client';

import type { MarketRow } from '@opennext/contracts';
import { useRegions, regionCode } from '@/features/market';
import { useIsDemo, useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { FEE_LABEL } from '../fees';
import { marketRows, type MarketSide } from '../exchange';
import { useMarketplaceView } from '../market-view';
import { useOpportunity } from './opportunity';
import {
  PBtn,
  externalCommitment,
  externalName,
  externalNotice,
  externalQuantity,
  rowPrice,
} from './shared';

/** Supply & Demand listing table on the market page (legacy `listingTable`). */
export function ListingTable() {
  const { openModal } = useTerminal();
  const model = useWorkspaceStore((s) => s.model);
  const region = useWorkspaceStore((s) => s.region);
  const count = useWorkspaceStore((s) => s.count);
  const term = useWorkspaceStore((s) => s.term);
  const role = useWorkspaceStore((s) => s.role);
  const regions = useRegions();
  const code = (value: string) => regionCode(regions, value);
  const market = useMarketplaceView();
  const demo = useIsDemo();
  const { open: openOpportunity, inquire } = useOpportunity();
  const filters = { model, region, count, term, role };
  const sides: [MarketSide, string][] =
    role === 'buyer'
      ? [
          ['supply', 'Supply'],
          ['demand', 'RFQs'],
        ]
      : [
          ['demand', 'RFQs'],
          ['supply', 'Supply'],
        ];
  const bySide = Object.fromEntries(
    sides.map(([side]) => [side, marketRows(market, filters, side, demo, code)]),
  ) as Record<MarketSide, MarketRow[]>;
  const allRows = sides.flatMap(([side]) => bySide[side]);
  const hasReference = allRows.some((r) => r.referenceOnly);
  const hasExternal = allRows.some((r) => r.external);
  return (
    <div className="compare proc-market-listings">
      <div className="compare-title">
        <span>{model} Supply &amp; Demand</span>
        <small>
          {hasExternal
            ? 'Marketplace & sourced requirements'
            : hasReference
              ? 'Reference listings · confirmation required'
              : 'Verified marketplace records'}
        </small>
      </div>
      {sides.map(([side, label]) => {
        const rows = bySide[side];
        const supply = side === 'supply';
        const canAct = supply ? role === 'buyer' : role === 'seller';
        const prices = rows.filter((r) => r.price != null).map((r) => Number(r.price));
        const best = prices.length > 1 && new Set(prices).size > 1 ? Math.min(...prices) : null;
        return (
          <section key={side} className="proc-market-section">
            <h3>{label}</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Counterparty</th>
                    <th>Country / region</th>
                    <th>$/GPU-hour</th>
                    <th>Quantity / term</th>
                    <th>{role === 'buyer' ? 'Bidding Parties' : 'Capacity'}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const quantity = r.external ? externalQuantity(r) : r.count + ' GPU';
                    const terms = r.external ? externalCommitment(r) : r.hours + 'h · ' + r.term;
                    const actionable =
                      canAct &&
                      !r.referenceOnly &&
                      (!r.external || r.responseMode === 'operations');
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.external ? externalName(r) : r.provider}</strong>
                          <small className="proc-sub">{r.id}</small>
                        </td>
                        <td>{r.region}</td>
                        <td className={supply && r.price === best ? 'best' : undefined}>
                          {rowPrice(r)}
                        </td>
                        <td>
                          {quantity}
                          <small className="proc-sub">{terms}</small>
                        </td>
                        <td>
                          {role === 'buyer'
                            ? r.referenceOnly || r.external
                              ? '—'
                              : Number(r.biddingParties || 0)
                            : quantity}
                        </td>
                        <td>
                          <PBtn
                            data-act="proc-listing"
                            data-id={r.id}
                            onClick={() => openModal('proc-listing', { id: r.id })}
                          >
                            Details
                          </PBtn>
                          {actionable ? (
                            <>
                              {' '}
                              <PBtn
                                primary
                                data-act={r.external ? 'proc-external-inquiry' : 'proc-opportunity'}
                                data-id={r.id}
                                data-intent={supply ? 'buy' : 'offer'}
                                onClick={() =>
                                  r.external
                                    ? inquire(r)
                                    : openOpportunity(r.id, supply ? 'buy' : 'offer')
                                }
                              >
                                {supply ? 'Buy capacity' : 'Offer capacity'}
                              </PBtn>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  <tr hidden={rows.length > 0}>
                    <td colSpan={6}>
                      No {supply ? 'published supply' : 'open RFQs'} match these filters.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="form-note proc-market-note">
        {hasExternal ? externalNotice() + ' ' : ''}
        {hasReference
          ? 'Reference listings reuse the preview catalog; they are not verified inventory or executable quotes. '
          : ''}
        Bidding Parties counts unique verified buyers who requested a quote for this GPU model in
        the last 30 days. Listed prices are base unit prices. {FEE_LABEL} is shown separately at
        buyer checkout and deducted separately from seller settlement.
      </p>
    </div>
  );
}
