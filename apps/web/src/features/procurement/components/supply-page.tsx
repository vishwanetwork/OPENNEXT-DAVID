'use client';

import type { MarketRow, OwnedSupply, SupplierResponse } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useRegions, regionCode } from '@/features/market';
import { useIsDemo, useTerminal, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { FEE_LABEL, baseRate } from '../fees';
import { marketRows, unitSuffix } from '../exchange';
import { useMarketplaceView } from '../market-view';
import { NotificationsPanel } from './notifications';
import { useOpportunity } from './opportunity';
import {
  PBtn,
  Tag,
  date,
  externalCommitment,
  externalNotice,
  externalQuantity,
  rowPrice,
} from './shared';

/** Buyer requirements matched to the current filters (legacy `supplyDemand`). */
export function SupplyDemand() {
  const { openModal } = useTerminal();
  const model = useWorkspaceStore((s) => s.model);
  const region = useWorkspaceStore((s) => s.region);
  const count = useWorkspaceStore((s) => s.count);
  const term = useWorkspaceStore((s) => s.term);
  const role = useWorkspaceStore((s) => s.role);
  const regions = useRegions();
  const market = useMarketplaceView();
  const demo = useIsDemo();
  const { open, inquire } = useOpportunity();
  const rows = marketRows(market, { model, region, count, term, role }, 'demand', demo, (v) =>
    regionCode(regions, v),
  ).slice(0, 5);
  const reference = rows.some((r) => r.referenceOnly);
  const sourced = rows.some((r) => r.external);
  const act = (r: MarketRow) =>
    r.referenceOnly
      ? openModal('proc-listing', { id: r.id })
      : r.external
        ? inquire(r)
        : open(r.id, 'offer');
  return (
    <section className="panel">
      <h2>{reference ? 'Buyer requirement references' : 'Buyer requirements'}</h2>
      <p className="form-note">
        Matched to {model} · {region}.{' '}
        {sourced
          ? externalNotice(rows.find((r) => r.external))
          : reference
            ? 'Illustrative requirements from the preview catalog; not active buyer orders.'
            : 'Change market filters to explore other requirements.'}
      </p>
      {rows.map((r) => (
        <div key={r.id} className="proc-notice">
          <div>
            <strong>
              {r.model} · {r.external ? externalQuantity(r) : r.count + ' GPU'}
            </strong>
            <p>
              {r.region} · {r.external ? externalCommitment(r) : r.hours + 'h'} · target{' '}
              {rowPrice(r)}
              {r.price == null ? '' : '/GPU-hour'}
            </p>
          </div>
          <PBtn
            data-act={
              r.referenceOnly
                ? 'proc-listing'
                : r.external
                  ? 'proc-external-inquiry'
                  : 'proc-opportunity'
            }
            data-id={r.id}
            data-intent={r.referenceOnly ? undefined : 'offer'}
            onClick={() => act(r)}
          >
            {r.referenceOnly ? 'Details' : 'Offer capacity'}
          </PBtn>
        </div>
      ))}
    </section>
  );
}

/** My RFQ responses + notifications (legacy `supplyExtra`). */
export function SupplyExtra() {
  const { openModal } = useTerminal();
  const responses = useWorkspaceData().responses as SupplierResponse[];
  return (
    <>
      <section className="panel">
        <h2>My RFQ responses</h2>
        {responses.length ? (
          responses.map((r) => (
            <div key={r.id} className="proc-notice">
              <div>
                <strong>
                  {r.model} · {r.rfqId}
                </strong>
                <p>
                  {money(r.rate)}
                  {unitSuffix(r)} · {r.status} · valid {date(r.validUntil)}
                </p>
              </div>
              <PBtn
                data-act="proc-response"
                data-id={r.id}
                onClick={() => openModal('proc-response', { id: r.id })}
              >
                View response
              </PBtn>
            </div>
          ))
        ) : (
          <p className="form-note">
            Respond to a buyer requirement to start a capacity verification.
          </p>
        )}
      </section>
      <NotificationsPanel />
    </>
  );
}

/** My Supply (legacy `supplyPage`). */
export function SupplyPage() {
  const { openModal } = useTerminal();
  const workspace = useWorkspaceData();
  const review = workspace.review;
  const listings = workspace.listings as OwnedSupply[];
  const reviewed = review.status === 'Approved';
  const pending = review.status === 'Reviewing';
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>My Supply</h1>
          <p>Verified capacity, visible to qualified buyers.</p>
        </div>
        <PBtn
          primary
          data-act="new-supply"
          onClick={() => openModal(reviewed ? 'supply-form' : 'review')}
        >
          List supply
        </PBtn>
      </div>
      <section className="panel">
        <div className="row spread">
          <div>
            <h2>Supplier review</h2>
            <p className="form-note">
              Complete eligibility, business verification and capacity rights before publishing
              supply.
            </p>
          </div>
          <Tag className={pending ? 'proc-reviewing' : ''}>{review.status || 'Not started'}</Tag>
        </div>
        <div className="proc-review-steps">
          {['Eligibility', 'KYB', 'Rights'].map((label) => (
            <span key={label} className={reviewed ? 'approved' : pending ? 'reviewing' : ''}>
              {reviewed ? '✓ ' : pending ? '◷ ' : ''}
              {label}
              {label === 'KYB' && pending ? ' · Reviewing' : ''}
            </span>
          ))}
        </div>
        <PBtn data-act="review" onClick={() => openModal('review')}>
          {reviewed
            ? 'View approval record'
            : pending
              ? 'View submission'
              : 'Start supplier review'}
        </PBtn>
        {pending ? (
          <p className="form-note">
            Your submission is being reviewed by operations. You will receive a workspace
            notification when a decision is ready.
          </p>
        ) : null}
      </section>
      <section className="panel">
        <h2>Your capacity</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>GPU / quantity</th>
                <th>Region</th>
                <th>Base unit price</th>
                <th>Settlement fee</th>
                <th>Verification</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.model || r.name}</strong>
                    <small className="proc-sub">
                      {r.count} GPU · {r.hours} hours
                    </small>
                  </td>
                  <td>{r.region}</td>
                  <td>{money(baseRate(r))}</td>
                  <td>{FEE_LABEL}</td>
                  <td>
                    {r.status}
                    <small className="proc-sub">Agent: {r.agentStatus}</small>
                  </td>
                  <td>
                    <PBtn
                      data-act="proc-supply-status"
                      data-id={r.id}
                      onClick={() => openModal('proc-supply-status', { id: r.id })}
                    >
                      View details
                    </PBtn>
                  </td>
                </tr>
              ))}
              {!listings.length ? (
                <tr>
                  <td colSpan={6}>
                    No supply submitted yet. Saved submissions appear here immediately; publication
                    waits for verification.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <SupplyDemand />
      <SupplyExtra />
    </div>
  );
}
