'use client';

import type { ReactNode } from 'react';
import type { MarketRow, OwnedRfq, SettlementRow, SupplierResponse } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useTerminal, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { baseRate } from '../fees';
import { unitSuffix } from '../exchange';
import { ResponseForm } from './forms';
import { useOpportunity } from './opportunity';
import {
  FeeBreakdown,
  FieldList,
  PBtn,
  canInquire,
  date,
  externalCommitment,
  externalName,
  externalNotice,
  externalQuantity,
  numberLabel,
  rowPrice,
} from './shared';

/* ---------- Listings ---------- */
export function ExternalDetails({ item }: { item: MarketRow }) {
  const { closeModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const { inquire } = useOpportunity();
  const supply = item.side === 'supply';
  const fields: [ReactNode, ReactNode][] = [
    [supply ? 'Offer' : 'Requirement', item.id],
    ['Record type', externalName(item)],
    ['GPU model', item.model],
    ['Country / region', item.region],
    ['Quantity', externalQuantity(item)],
    ['GPUs per node', item.quantity?.gpusPerNode ?? 'To confirm'],
    ['Rental commitment', externalCommitment(item)],
    [
      supply ? 'Listed price' : 'Buyer target price',
      rowPrice(item) + (item.price == null ? '' : ' / GPU-hour'),
    ],
    ['Urgency', item.urgency || 'To confirm'],
  ];
  if ((item.modelOptions?.length || 0) > 1)
    fields.push(['Acceptable GPU alternatives', item.modelOptions!.join(' / ')]);
  if (item.rentalMonths?.preferred != null)
    fields.push(['Preferred commitment', numberLabel(item.rentalMonths.preferred) + ' months']);
  if (item.rentalMonths?.notes) fields.push(['Commitment notes', item.rentalMonths.notes]);
  return (
    <>
      <div className="details-grid">
        <FieldList items={fields} />
      </div>
      <p className="proc-notes">{item.description || ''}</p>
      <div className="callout">{externalNotice(item)}</div>
      <p className="form-note">
        Submitting an inquiry does not place an order or confirm{' '}
        {supply ? 'supplier inventory' : 'a buyer account'}. OpenNEXT operations coordinates the
        next step.
      </p>
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Close
        </PBtn>
        {canInquire(role, item) ? (
          <PBtn
            primary
            data-act="proc-external-inquiry"
            data-id={item.id}
            onClick={() => inquire(item)}
          >
            {supply ? 'Request quote' : 'Offer capacity'}
          </PBtn>
        ) : null}
      </div>
    </>
  );
}

export const externalTitle = (item: MarketRow) =>
  item.title || item.model + (item.side === 'supply' ? ' capacity offer' : ' capacity requirement');

export function ListingDialog({
  type,
  item,
}: {
  type: 'proc-listing' | 'proc-settlement';
  item: (MarketRow & Partial<SettlementRow>) | null | undefined;
}) {
  const { closeModal, openModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const review = useWorkspaceData().review.status;
  const { open } = useOpportunity();
  if (!item) return <>Refresh the market to load this record.</>;
  if (item.external) return <ExternalDetails item={item} />;
  if (item.referenceOnly)
    return (
      <>
        <div className="details-grid">
          <FieldList
            items={[
              [
                'Record type',
                String(item.side) === 'activity'
                  ? 'Reference activity'
                  : item.side === 'supply'
                    ? 'Supply reference'
                    : 'RFQ reference',
              ],
              ['Country / region', item.region],
              ['Price', money(item.price) + ' / GPU-hour'],
              ['Quantity', item.count + ' GPU'],
              ['Duration', item.hours + ' hours'],
              ['Market terms', item.term],
            ]}
          />
        </div>
        <p className="proc-notes">{item.description || ''}</p>
        <div className="callout">
          This reference comes from the preview catalog. It does not confirm available inventory, an
          active buyer requirement or a completed transaction. Submit your own requirement to
          request current availability and pricing.
        </div>
        <div className="modal-footer">
          <PBtn data-act="close-modal" onClick={closeModal}>
            Close
          </PBtn>
          {role === 'buyer' ? (
            <PBtn data-act="new-rfq" onClick={() => openModal('rfq-form')}>
              Post RFQ
            </PBtn>
          ) : (
            <PBtn
              data-act="new-supply"
              onClick={() => openModal(review === 'Approved' ? 'supply-form' : 'review')}
            >
              List Supply
            </PBtn>
          )}
        </div>
      </>
    );
  const canAct = item.side === 'supply' ? role === 'buyer' : role === 'seller';
  return (
    <>
      <div className="details-grid">
        <FieldList
          items={[
            ['Side', type === 'proc-settlement' ? 'Settled' : item.side],
            ['Region', item.region],
            ['Price', money(item.price) + unitSuffix(item)],
            ['Capacity', item.count + ' GPU'],
            ['Term', item.term],
            ['Duration', item.hours + ' hours'],
            ['Counterparty', item.provider],
            ['Date', date(item.settledAt || item.created)],
          ]}
        />
      </div>
      <p className="proc-notes">{item.description || ''}</p>
      {type === 'proc-listing' && canAct ? (
        <div className="modal-footer">
          <PBtn
            primary
            data-act="proc-opportunity"
            data-id={item.id}
            data-intent={item.side === 'supply' ? 'buy' : 'offer'}
            onClick={() => open(item.id, item.side === 'supply' ? 'buy' : 'offer')}
          >
            {item.side === 'supply' ? 'Buy capacity' : 'Offer capacity'}
          </PBtn>
        </div>
      ) : null}
    </>
  );
}

export const listingTitle = (item: (MarketRow & Partial<SettlementRow>) | null | undefined) =>
  !item
    ? 'Record unavailable'
    : item.external
      ? externalTitle(item)
      : item.referenceOnly
        ? item.model + ' Reference details'
        : item.model + ' ' + item.provider;

export function ResponseDialog({ req }: { req: OwnedRfq | MarketRow | undefined }) {
  if (!req) return <>This RFQ is no longer available.</>;
  if ((req as MarketRow).external) return <ExternalDetails item={req as MarketRow} />;
  const r = req as OwnedRfq;
  return (
    <>
      <p className="form-note">
        {r.model} {r.count} GPU {r.region}
      </p>
      <ResponseForm req={r} />
    </>
  );
}

export function ResponseRecord({ response }: { response: SupplierResponse | undefined }) {
  const { openModal } = useTerminal();
  if (!response) return <>The response could not be found.</>;
  return (
    <>
      <div className="details-grid">
        <FieldList
          items={[
            ['RFQ', response.rfqId],
            ['Base unit price', money(baseRate(response))],
            ['Status', response.status],
            ['Valid until', date(response.validUntil)],
            ['Verified supply', response.supplyId],
          ]}
        />
      </div>
      <p className="proc-notes">{response.notes}</p>
      <FeeBreakdown record={response} side="sell" />
      <p className="form-note">
        The buyer reviews this quote in their account. Acceptance and payment are separate verified
        steps.
      </p>
      {response.orderId ? (
        <PBtn
          data-act="bill-order"
          data-id={response.orderId}
          onClick={() => openModal('bill-order', { id: String(response.orderId) })}
        >
          View order
        </PBtn>
      ) : null}
    </>
  );
}
