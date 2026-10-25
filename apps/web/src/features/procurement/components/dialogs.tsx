'use client';

import type { ReactNode } from 'react';
import type {
  KybReview,
  MarketRow,
  Order,
  OwnedRfq,
  OwnedSupply,
  Quote,
  SettlementRow,
  SupplierResponse,
} from '@opennext/contracts';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useApi } from '@/components/providers/api-context';
import { RfqDetails } from '@/features/rfq-details';
import { useTerminal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { procurementApi } from '../api';
import { FEE_LABEL, baseRate, currentFees, maximumQuotePrice } from '../fees';
import { deliveryMethod, isHardware, isModel, totalFor, unitSuffix } from '../exchange';
import { useRunServer } from '../hooks';
import { refreshMarketplace } from '../workspace';
import { KybForm, ResponseForm, SupplyForm } from './forms';
import { useOpportunity } from './opportunity';
import {
  FeeBreakdown,
  Field,
  FieldList,
  PBtn,
  ReceiptDetails,
  RfqReviewNote,
  Tag,
  canInquire,
  date,
  deliveryTime,
  externalCommitment,
  externalName,
  externalNotice,
  externalQuantity,
  numberLabel,
  rfqStatus,
  rowPrice,
  volume,
} from './shared';

/* ---------- Supplier review (KYB) ---------- */

export function ReviewDialog() {
  const r = useWorkspaceStore((s) => s.review) as KybReview & { step: number };
  const patch = useWorkspaceStore((s) => s.patch);
  if (['Reviewing', 'Approved', 'Rejected'].includes(r.status))
    return (
      <>
        <Tag className={r.status === 'Reviewing' ? 'proc-reviewing' : ''}>{r.status}</Tag>
        <div className="details-grid">
          <FieldList
            items={[
              ['Company', r.company],
              ['Registration', r.registration],
              ['Country', r.country],
              ['Submitted', date(r.submittedAt)],
            ]}
          />
        </div>
        <p className="form-note">
          {r.status === 'Reviewing'
            ? 'Your application is in review. Listing is locked until operations approves your business identity and rights.'
            : r.status === 'Approved'
              ? 'Your business is approved. Each capacity submission still requires successful agent installation.'
              : r.reason || 'Review the submission and provide the requested evidence.'}
        </p>
        {r.status === 'Rejected' ? (
          <PBtn
            data-act="proc-kyb-revise"
            onClick={() => patch({ review: { ...r, status: 'Draft' } })}
          >
            Revise submission
          </PBtn>
        ) : null}
      </>
    );
  return <KybForm />;
}

export const reviewTitle = (status: string) =>
  ['Reviewing', 'Approved', 'Rejected'].includes(status)
    ? 'Supplier review'
    : 'Verify your business';

export function SupplyDialog() {
  const status = useWorkspaceStore((s) => s.review.status);
  return status === 'Approved' ? <SupplyForm /> : <ReviewDialog />;
}

export function SupplyStatus({ id }: { id: string }) {
  const listings = useWorkspaceStore((s) => s.listings) as OwnedSupply[];
  const api = useApi();
  const toast = useToast();
  const { run, busy } = useRunServer();
  const r = listings.find((row) => row.id === id);
  if (!r) return <>Refresh your supply list to load this record.</>;
  return (
    <>
      <ReceiptDetails record={r} />
      <div className="details-grid">
        <FieldList
          items={[
            ['Supply', r.id],
            ['Status', r.status],
            ['Agent', r.agentStatus],
            ['Country', r.region],
            ['Base unit price', money(baseRate(r))],
            ['Seller fee', FEE_LABEL + ' deducted at settlement'],
            ['Service starts', date(r.serviceStart)],
            ['Service ends', date(r.serviceEnd)],
          ]}
        />
      </div>
      <div className="callout">
        {r.agentStatus === 'Succeeded'
          ? 'Agent installation is verified. This supply is available in the marketplace.'
          : 'Agent installation must be completed by the backend integration before this offer can be published. Browser actions cannot approve installation.'}
      </div>
      <div className="modal-footer">
        {['Pending', 'Failed'].includes(String(r.agentStatus)) ? (
          <PBtn
            primary
            data-act="proc-agent-request"
            data-id={r.id}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await procurementApi.requestAgent(api, r.id);
                if (result.message) toast(result.message);
              })
            }
          >
            Request installation update
          </PBtn>
        ) : null}
        <PBtn data-act="proc-refresh" disabled={busy} onClick={() => void run(async () => {})}>
          Refresh status
        </PBtn>
      </div>
    </>
  );
}

/* ---------- RFQ record ---------- */

const txt = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

export function RequirementFields({ r }: { r: OwnedRfq }) {
  const identity = useWorkspaceStore((s) => s.identity);
  const hardware = isHardware(r);
  const model = isModel(r);
  const common: [ReactNode, ReactNode][] = [
    ['Project / purpose', r.project || r.title],
    ['Client / procurement owner', r.client || identity.company || identity.name],
    ['GPU / model', r.model],
    ['Capacity', volume(r)],
    ['Region / data location', r.region],
    ['Commercial terms', r.term || 'Model capacity'],
    [hardware ? 'Required arrival' : 'Start time', date(r.start)],
    [
      'Budget',
      money(r.budget) +
        unitSuffix(r) +
        (model ? '' : ' · ' + money(totalFor(r, r.budget)) + ' maximum'),
    ],
    ['Quote deadline', date(r.quoteDeadline)],
    ['Delivery method', r.deliveryMethod || deliveryMethod(r)],
    ['Urgency', r.urgency],
    ['Visibility', r.visibility],
  ];
  const specific: [ReactNode, ReactNode][] = hardware
    ? [
        ['Condition', txt(r.condition) || 'Brand new'],
        [
          'Shipping address / destination',
          txt(r.shippingAddress) || 'Confirm securely before shipment',
        ],
        ['Incoterms', txt(r.incoterms) || 'DAP · confirm fees'],
        ['Warranty', txt(r.warranty) || 'Confirm in quotation'],
      ]
    : model
      ? [
          ['Exact model / tier SKU', r.sku || 'Confirm in quotation'],
          ['Duration', r.days + ' days'],
          ['Required throughput', (r.tps || 'To confirm') + ' TPS'],
          [
            'Access / data policy',
            txt(r.accessPolicy) || 'Confirm authorization, retention and region',
          ],
        ]
      : [
          ['Duration', r.hours + ' hours'],
          [
            'Network / storage',
            `${txt(r.network) || 'Confirm with supplier'} / ${txt(r.storage) || 'Confirm with supplier'}`,
          ],
          ['Image / runtime', txt(r.image) || 'Confirm with supplier'],
        ];
  return (
    <>
      <div className="details-grid proc-details">
        <FieldList
          items={[...common, ...specific, ['SLA / support', txt(r.sla) || 'Confirm with supplier']]}
        />
      </div>
      <h3>Requirement notes</h3>
      <p className="proc-notes">{r.notes || 'No additional requirements.'}</p>
    </>
  );
}

const tokenPrice = (v: unknown) =>
  '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
const expired = (q: Quote) => !q.validUntil || new Date(q.validUntil) <= new Date();

export function QuoteRows({ r }: { r: OwnedRfq }) {
  const { openModal } = useTerminal();
  const api = useApi();
  const toast = useToast();
  const { run, busy } = useRunServer();
  const quotes = (r.quotes || []).filter((q) => q.status === 'Pending');
  const reject = (q: Quote) =>
    void run(async () => {
      if (!r.serverRecord) throw new Error('Refresh the verified quotation record.');
      await procurementApi.decideQuote(api, r.id, q.id, 'reject');
      toast('Quote rejected.');
    });
  return (
    <>
      <div className="row spread">
        <h3>{r.originSupply ? 'Selected supplier quotation' : 'Competing supplier quotes'}</h3>
        <span className="form-note">{quotes.length} to review</span>
      </div>
      {quotes.length ? (
        quotes.map((q) => (
          <article key={q.id} className="proc-quote">
            <div className="row spread">
              <div>
                <strong>{q.provider}</strong>
                <small className="proc-sub">
                  {q.id}
                  {q.sample ? ' · Preview quote' : ''}
                </small>
              </div>
              <strong>
                {money(q.price)}
                {unitSuffix(r)}
              </strong>
            </div>
            {isModel(r) && q.input != null && q.output != null ? (
              <p className="form-note">
                Input {tokenPrice(q.input)} / 1M tokens · Output {tokenPrice(q.output)} / 1M tokens
              </p>
            ) : null}
            <div className="proc-quote-meta">
              <span>Base {money(q.subtotal ?? q.total)}</span>
              <span>
                {currentFees(q)
                  ? FEE_LABEL + ' ' + money(q.buyerFee) + ' · Total payable ' + money(q.buyerTotal)
                  : 'Updated fee breakdown required'}
              </span>
              <span>Delivery {deliveryTime(q.delivery, r)}</span>
              <span>
                {isHardware(r) ? 'Warranty' : 'SLA'} {q.sla || 'Confirm'}
              </span>
              <span>{expired(q) ? 'Expired' : 'Valid until ' + date(q.validUntil)}</span>
            </div>
            <p className="form-note">
              {q.deliveryMethod || r.deliveryMethod} ·{' '}
              {q.notes || 'Terms attached to the quotation.'}
            </p>
            <div className="row">
              <PBtn
                data-act="proc-quote-details"
                data-id={r.id}
                data-quote={q.id}
                onClick={() => openModal('proc-quote-details', { id: r.id, quoteId: q.id })}
              >
                Details
              </PBtn>
              <span className="gap"></span>
              <PBtn
                data-act="proc-reject"
                data-id={r.id}
                data-quote={q.id}
                disabled={busy}
                onClick={() => reject(q)}
              >
                Reject
              </PBtn>
              <button
                type="button"
                className="btn small"
                data-act="proc-accept-review"
                data-id={r.id}
                data-quote={q.id}
                disabled={expired(q)}
                onClick={() => openModal('proc-accept-review', { id: r.id, quoteId: q.id })}
              >
                Accept
              </button>
            </div>
          </article>
        ))
      ) : (
        <p className="form-note">No pending quotes. Rejected quotes remain in the audit trail.</p>
      )}
    </>
  );
}

export function RecordView({ r }: { r: OwnedRfq | undefined }) {
  const { openModal } = useTerminal();
  const orders = useWorkspaceStore((s) => s.orders) as Order[];
  const toast = useToast();
  if (!r) return <p>Requirement not found.</p>;
  const order = orders.find((o) => o.id === r.orderId);
  const backendOnly = () =>
    toast(
      'This action requires a verified backend transaction. Contact operations for assistance.',
    );
  return (
    <>
      <ReceiptDetails record={r} />
      <div className="row spread">
        <span className="form-note">
          {r.id}
          {r.sample ? ' · Preview requirement' : ''}
        </span>
        <Tag>{rfqStatus(r)}</Tag>
      </div>
      <RfqReviewNote r={r} />
      <RequirementFields r={r} />
      {['Open', 'Quoted'].includes(r.status) ? <QuoteRows r={r} /> : null}
      {order ? (
        <section className="proc-award">
          <h3>Selected supplier · {order.provider}</h3>
          <p>
            {order.id} · {money(order.total)} · {order.status}
          </p>
          <div className="row">
            <PBtn
              data-act="bill-order"
              data-id={order.id}
              onClick={() => openModal('bill-order', { id: order.id })}
            >
              Order details
            </PBtn>
            {order.paymentStatus !== 'Paid' ? (
              <PBtn
                primary
                data-act="proc-payment"
                data-id={order.id}
                onClick={() => openModal('proc-payment', { id: order.id })}
              >
                Review &amp; pay
              </PBtn>
            ) : order.status === 'Paid' ? (
              <PBtn
                primary
                data-act="proc-delivery"
                data-id={order.id}
                onClick={() => openModal('proc-delivery', { id: order.id })}
              >
                Confirm delivery details
              </PBtn>
            ) : order.status === 'Provisioning' ? (
              <PBtn
                primary
                data-act="proc-verify"
                data-id={order.id}
                onClick={() => openModal('proc-verify', { id: order.id })}
              >
                Verify delivery
              </PBtn>
            ) : order.status === 'Active' ? (
              <PBtn
                primary
                data-act="proc-manage"
                data-id={order.id}
                onClick={() => openModal('proc-manage', { id: order.id })}
              >
                Manage service
              </PBtn>
            ) : (
              <PBtn
                data-act="bill-order"
                data-id={order.id}
                onClick={() => openModal('bill-order', { id: order.id })}
              >
                View completed order
              </PBtn>
            )}
          </div>
        </section>
      ) : null}
      <div className="modal-footer">
        {['Reviewing', 'Rejected', 'Open', 'Quoted'].includes(r.status) ? (
          <PBtn
            data-act="proc-edit"
            data-id={r.id}
            onClick={() => openModal('proc-edit', { id: r.id })}
          >
            Edit requirement
          </PBtn>
        ) : null}
        {['Open', 'Quoted'].includes(r.status) ? (
          <PBtn data-act="proc-close" data-id={r.id} onClick={backendOnly}>
            Close RFQ
          </PBtn>
        ) : null}
      </div>
      <details className="proc-audit">
        <summary>Decision history &amp; rejected quotes</summary>
        {(r.audit || []).length ? (
          (r.audit || []).map((a, i) => (
            <p key={i}>
              {date(a.at)} · {a.event}
            </p>
          ))
        ) : (
          <p>No decisions yet.</p>
        )}
        {(r.quotes || [])
          .filter((q) => q.status !== 'Pending')
          .map((q) => (
            <p key={q.id}>
              {q.provider} · {q.status} · {money(q.price)}
            </p>
          ))}
      </details>
    </>
  );
}

export function AcceptReview({ r, q }: { r: OwnedRfq; q: Quote | undefined }) {
  const { openModal } = useTerminal();
  const api = useApi();
  const toast = useToast();
  const { run, busy } = useRunServer();
  const accept = () =>
    void run(async () => {
      if (!r.serverRecord || !q) throw new Error('Refresh the verified quotation record.');
      if (!currentFees(q))
        throw new Error(
          'Request an updated quote with the complete fee breakdown before acceptance.',
        );
      await procurementApi.decideQuote(api, r.id, q.id, 'accept');
      toast('Supplier selected. The order awaits payment integration.');
    });
  return (
    <>
      <div className="details-grid">
        <Field label="Supplier" value={q?.provider} />
        <Field label="Base unit price" value={money(q?.price) + unitSuffix(r)} />
        <Field label="Delivery" value={deliveryTime(q?.delivery, r)} />
        <Field label="Valid until" value={date(q?.validUntil)} />
      </div>
      <FeeBreakdown record={q} />
      <p className="form-note">
        Accepting selects this supplier and closes the other pending quotes.{' '}
        {r.shareClosingPrice
          ? 'Participating suppliers will see the closing price.'
          : 'The closing price remains private.'}{' '}
        Payment is a separate step.
      </p>
      {!currentFees(q) ? (
        <p className="form-note">
          Request an updated quote with the complete fee breakdown before acceptance.
        </p>
      ) : null}
      <div className="modal-footer">
        <PBtn data-act="view-rfq" data-id={r.id} onClick={() => openModal('rfq', { id: r.id })}>
          Back to quotes
        </PBtn>
        <PBtn
          primary
          data-act="proc-accept-confirm"
          data-id={r.id}
          data-quote={q?.id}
          disabled={!currentFees(q) || busy}
          onClick={accept}
        >
          Confirm acceptance
        </PBtn>
      </div>
    </>
  );
}

export function QuoteDetails({ r, q }: { r: OwnedRfq; q: Quote | undefined }) {
  const { openModal } = useTerminal();
  return (
    <>
      <RequirementFields r={r} />
      <div className="details-grid">
        <FieldList
          items={[
            ['Base unit price', money(q?.price) + unitSuffix(r)],
            ['Delivery lead time', deliveryTime(q?.delivery, r)],
            ['SLA / warranty', q?.sla],
            ['Payment terms', q?.paymentTerms],
            ['Delivery method', q?.deliveryMethod],
            ['Cancellation', q?.cancellation],
            ['Valid until', date(q?.validUntil)],
          ]}
        />
      </div>
      <FeeBreakdown record={q} />
      <div className="modal-footer">
        <PBtn data-act="view-rfq" data-id={r.id} onClick={() => openModal('rfq', { id: r.id })}>
          Back to quotes
        </PBtn>
      </div>
    </>
  );
}

export function RequestDetails({ r }: { r: OwnedRfq | undefined }) {
  const { closeModal } = useTerminal();
  return (
    <>
      {r ? (
        <RfqDetails
          record={r as unknown as Parameters<typeof RfqDetails>[0]['record']}
          money={money}
          date={date}
        />
      ) : (
        <p className="form-note">Refresh RFQs &amp; Quote to load this request.</p>
      )}
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Close
        </PBtn>
      </div>
    </>
  );
}

/* ---------- Orders ---------- */

export function OrderAction({
  type,
  o,
}: {
  type: 'proc-payment' | 'proc-delivery' | 'proc-verify' | 'proc-manage';
  o: Order | undefined;
}) {
  const { go, closeModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  if (!o) return <>The order could not be found.</>;
  const side = o.side || (role === 'Seller' ? 'sell' : 'buy');
  const note =
    type === 'proc-payment'
      ? 'Secure order checkout is not connected yet. The payment provider must confirm payment before provisioning begins. No funds have been charged.'
      : type === 'proc-delivery'
        ? 'Delivery begins after verified payment and backend provisioning. Access details will be attached to this order by the delivery integration.'
        : type === 'proc-verify'
          ? 'Acceptance checks become available after the backend confirms delivery. Browser actions cannot create or activate GPU instances.'
          : 'Manage active capacity in My Instances. The backend verifies service windows, access rights and utilization before changes are allowed.';
  return (
    <>
      <div className="details-grid">
        <FieldList
          items={[
            ['Order', o.id],
            ['Resource', o.model],
            ['Region', o.region],
            ['Quantity', o.count + ' GPU'],
            ['Base unit price', money(o.unitPrice ?? o.rate)],
            ['Payment', o.paymentStatus || 'Unpaid'],
            ['Service starts', date(o.serviceStart)],
            ['Service ends', date(o.serviceEnd)],
          ]}
        />
      </div>
      <FeeBreakdown record={o} side={side} />
      <div className="callout">{note}</div>
      <div className="modal-footer">
        {type === 'proc-payment' ? (
          <button
            className="btn"
            type="button"
            disabled
            title="Order payment integration is pending"
          >
            Proceed to payment
          </button>
        ) : null}
        <button
          className="btn secondary"
          type="button"
          data-nav={type === 'proc-manage' ? 'instances' : 'billing'}
          onClick={() => {
            closeModal();
            go(type === 'proc-manage' ? 'instances' : 'billing');
          }}
        >
          {type === 'proc-manage' ? 'My Instances' : 'Open billing'}
        </button>
      </div>
    </>
  );
}

export const orderActionTitle = (type: string, o: Order | undefined) =>
  o
    ? (type === 'proc-payment'
        ? 'Review payment'
        : type === 'proc-delivery'
          ? 'Delivery details'
          : type === 'proc-verify'
            ? 'Verify delivery'
            : 'Manage service') +
      ' · ' +
      o.id
    : 'Order unavailable';

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
  const review = useWorkspaceStore((s) => s.review.status);
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
          {role === 'Buyer' ? (
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
  const canAct = item.side === 'supply' ? role === 'Buyer' : role === 'Seller';
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
        ? item.model + ' · Reference details'
        : item.model + ' · ' + item.provider;

export function ResponseDialog({ req }: { req: OwnedRfq | MarketRow | undefined }) {
  if (!req) return <>This RFQ is no longer available.</>;
  if ((req as MarketRow).external) return <ExternalDetails item={req as MarketRow} />;
  const r = req as OwnedRfq;
  return (
    <>
      <p className="form-note">
        {r.model} · {r.count} GPU · {r.region}
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
          onClick={() => openModal('bill-order', { id: response.orderId })}
        >
          View order
        </PBtn>
      ) : null}
    </>
  );
}

/* ---------- Submission + history ---------- */

export interface SubmissionModalState {
  id: string;
  recordKind: 'rfq' | 'supply';
  receipt: { receiptId: string; receivedAt: string; revision?: number } | null;
  recordStatus: string;
  warnings: string[];
  demo: boolean;
}

export const submissionTitle = (m: SubmissionModalState) =>
  m.recordKind !== 'supply'
    ? m.receipt
      ? 'Request submitted successfully'
      : 'Request saved'
    : m.demo
      ? 'Demo submission saved'
      : m.receipt
        ? 'Submission received'
        : 'Submission saved';

export function SubmissionModal({ m }: { m: SubmissionModalState }) {
  const { closeModal, go } = useTerminal();
  const confirmed = !!m.receipt;
  const supply = m.recordKind === 'supply';
  const view = (route: string) => {
    closeModal();
    go(route);
  };
  if (!supply)
    return (
      <>
        <div className="proc-request-success">
          <p>
            {confirmed
              ? 'Your request has been submitted successfully. Our team will match suitable capacity as soon as possible and notify you of the latest progress. Our sales team may also contact you by email.'
              : 'Your request has been saved. Operations receipt is not yet confirmed; refresh your records before submitting again.'}
          </p>
          <p className="form-note">
            You can find this request in RFQs &amp; Quote. It remains Reviewing until operations
            approves publication.
          </p>
          {m.warnings.map((message, i) => (
            <p key={i} className="form-note" role="status">
              {message}
            </p>
          ))}
        </div>
        <div className="modal-footer">
          <PBtn data-act="proc-submission-view" data-id="rfq" onClick={() => view('rfqs')}>
            RFQs &amp; Quote
          </PBtn>
          <PBtn primary data-act="close-modal" onClick={closeModal}>
            OK
          </PBtn>
        </div>
      </>
    );
  return (
    <>
      <p className="form-note">
        {m.demo
          ? 'This record belongs only to your isolated test workspace. It is not a production submission.' +
            (confirmed
              ? ' Operations can find it in Console under Demo submissions while this workspace is active.'
              : '')
          : confirmed
            ? 'Your capacity submission is available in the OpenNEXT operations inbox.'
            : 'The server saved your record. A Console receipt has not been confirmed by the connected backend.'}
      </p>
      <div className="details-grid">
        <FieldList
          items={[
            ['Record', m.id],
            ['Operations receipt', m.receipt?.receiptId || 'Not confirmed'],
            ['Received', m.receipt ? date(m.receipt.receivedAt) : 'Not confirmed'],
            ['Version', m.receipt?.revision || '—'],
            ['Marketplace status', m.recordStatus],
          ]}
        />
      </div>
      <div className="callout">
        Receipt does not publish capacity. KYB approval and verified agent installation are still
        required.
      </div>
      {m.warnings.map((message, i) => (
        <p key={i} className="form-note" role="status">
          {message}
        </p>
      ))}
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Close
        </PBtn>
        <PBtn
          primary
          data-act="proc-submission-view"
          data-id="supply"
          onClick={() => view('supply')}
        >
          View My Supply
        </PBtn>
      </div>
    </>
  );
}

export function HistoryUpgrade() {
  const { closeModal } = useTerminal();
  return (
    <>
      <p className="form-note">
        Historical data for up to 3 months is free. Contact Sales for access to 6M, 1Y or all
        available history.
      </p>
      <div className="modal-footer">
        <PBtn data-act="close-modal" onClick={closeModal}>
          Not now
        </PBtn>
        <PBtn
          primary
          data-act="proc-contact-sales"
          onClick={() => {
            closeModal();
            void import('@/features/terminal/components/TerminalModal').then((m) =>
              m.openContact(),
            );
          }}
        >
          Contact Sales
        </PBtn>
      </div>
    </>
  );
}

export { maximumQuotePrice, refreshMarketplace };
