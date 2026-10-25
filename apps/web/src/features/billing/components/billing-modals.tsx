'use client';

import type { ReactNode } from 'react';
import type { LedgerEntry, Order, Payout } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import {
  ModalFrame,
  downloadText,
  useBalance,
  useTerminal,
  useWorkspaceStore,
  type ModalComponent,
  type ModalComponents,
} from '@/terminal-kit';
import { useBillingData } from '../hooks';
import {
  FEE_LABEL,
  csv,
  currentFees,
  exportRows,
  ledgerAmount,
  ledgerLabel,
  num,
  orderAmount,
  orderCommission,
  orderSide,
  stamp,
  tokenUsd,
  usd,
  type BillingData,
} from '../analytics';
import { Detail } from './billing-page';
import { PaymentAmount, PaymentMethod, PaymentProvider, TopupStatus } from './payment-modals';

const Btn = ({
  act,
  primary = false,
  children,
  onClick,
  id,
  value,
}: {
  act: string;
  primary?: boolean;
  children: ReactNode;
  onClick?: () => void;
  id?: string;
  value?: string;
}) => (
  <button
    type="button"
    className={`btn ${primary ? '' : 'secondary'} small`}
    data-act={act}
    data-id={id}
    data-value={value}
    onClick={onClick}
  >
    {children}
  </button>
);

const party = (value: unknown, fallback: string) =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? [
          (value as { company?: string }).company,
          (value as { name?: string }).name,
          (value as { email?: string }).email,
        ]
          .filter(Boolean)
          .join(' · ') || fallback
      : fallback;

function OrderFeeRows({ o }: { o: Order }) {
  const seller = orderSide(o) === 'sell';
  if (currentFees(o))
    return (
      <>
        <Detail label="Base order amount" value={usd(o.subtotal)} />
        <Detail
          label={FEE_LABEL}
          value={(seller ? '−' : '+') + usd(seller ? o.sellerFee : o.buyerFee)}
        />
        <Detail
          label={seller ? 'Net proceeds · USD' : 'Total payable · USD'}
          value={usd(seller ? o.sellerNet : o.buyerTotal)}
        />
        <p className="form-note">
          {seller
            ? 'The seller fee is deducted from the base order amount at settlement.'
            : 'The buyer fee is added to the base order amount at checkout.'}{' '}
          The listed unit price is unchanged.
        </p>
      </>
    );
  const total = num(o.total == null ? o.amount : o.total);
  const subtotal = num(o.subtotal == null ? total - num(o.fees) - num(o.tax) : o.subtotal);
  return (
    <>
      <Detail label="Recorded subtotal" value={usd(subtotal)} />
      {o.fees != null ? <Detail label="Recorded fee" value={usd(o.fees)} /> : null}
      {o.tax != null ? <Detail label="Recorded tax" value={usd(o.tax)} /> : null}
      <Detail
        label={seller ? 'Recorded proceeds · USD' : 'Recorded order total · USD'}
        value={usd(orderAmount(o))}
      />
      <p className="form-note">
        Historical order amounts are unchanged. No new fee has been applied to this record.
      </p>
    </>
  );
}

function OrderPricing({ o }: { o: Order }) {
  const unitRate = o.unitPrice == null ? o.rate : o.unitPrice;
  if (!/model|token/i.test(String(o.kind || '')))
    return (
      <Detail
        label="Unit price"
        value={
          unitRate == null
            ? 'See accepted quote breakdown'
            : usd(unitRate) +
              (/physical|hardware/i.test(String(o.kind || '')) ? ' / GPU' : ' / GPU-hour')
        }
      />
    );
  const actual = (...values: unknown[]) =>
    values.find((v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)));
  const ox = o as Order & Record<string, unknown>;
  const rows: [string, unknown][] = [
    ['Input tokens', actual(o.inputRate, ox.inputPrice)],
    ['Output tokens', actual(o.outputRate, ox.outputPrice)],
    [
      'Cached input tokens',
      actual(ox.cacheRate, ox.cachePrice, ox.cachedInputRate, ox.cachedInputPrice),
    ],
  ];
  return (
    <>
      <Detail
        label="Total quoted token allocation"
        value={usd(o.subtotal == null ? (o.total == null ? o.amount : o.total) : o.subtotal)}
      />
      {rows
        .filter(([, value]) => value !== undefined)
        .map(([label, value]) => (
          <Detail key={label} label={label} value={tokenUsd(value) + ' / 1M tokens'} />
        ))}
    </>
  );
}

function OrderDelivery({ o }: { o: Order }) {
  const physical = /physical|hardware/i.test(String(o.kind || ''));
  const eta = o.deliveryMinutes
    ? physical
      ? 'Within ' +
        Number((num(o.deliveryMinutes) / 1440).toFixed(2)) +
        ' days after payment and shipping confirmation'
      : 'Within ' + o.deliveryMinutes + ' minutes after payment and access setup'
    : 'To be confirmed';
  const ox = o as Order & Record<string, unknown>;
  return (
    <>
      <h3 className="bill-section-title">
        {physical ? 'Shipping & acceptance' : 'Delivery & service'}
      </h3>
      <div className="bill-detail-grid">
        <Detail label="Order created" value={stamp(o.createdAt || o.created)} />
        <Detail
          label="Delivery method"
          value={o.deliveryMethod || (physical ? 'Shipment · to be confirmed' : 'To be confirmed')}
        />
        <Detail label="Expected delivery" value={eta} />
        {physical ? (
          <>
            <Detail
              label="Required arrival"
              value={stamp(ox.requiredArrival || ox.requiredDeliveryBy || o.serviceStart)}
            />
            <Detail
              label="Received"
              value={stamp(ox.receivedAt || o.deliveredAt || o.completedAt)}
            />
            {(
              [
                ['Consignee', o.consignee],
                ['Shipping address', o.shippingAddress],
                ['Contact phone', o.contactPhone],
                ['Condition', o.condition],
                ['Warranty', o.warranty],
                ['Shipping terms', o.incoterms],
              ] as [string, unknown][]
            )
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <Detail key={label} label={label} value={value} />
              ))}
            <Detail
              label="Cancellation / return"
              value={
                o.cancellationTerms || 'Subject to shipment status and accepted supplier terms'
              }
            />
            <Detail
              label="Acceptance terms"
              value={o.sla || 'Inspect SKU, serial numbers, condition and warranty on receipt'}
            />
          </>
        ) : (
          <>
            <Detail label="Delivered at" value={stamp(o.deliveredAt)} />
            <Detail label="Service starts" value={stamp(o.serviceStart)} />
            <Detail label="Service ends" value={stamp(o.serviceEnd)} />
            <Detail
              label="Cancellation / refund"
              value={o.cancellationTerms || 'Subject to accepted quote and delivery status'}
            />
            <Detail
              label="SLA / interruption"
              value={
                o.sla ||
                (o.term === 'Spot'
                  ? 'Interruptible; checkpointing recommended'
                  : 'Subject to accepted quote')
              }
            />
          </>
        )}
      </div>
    </>
  );
}

function OrderActions({ o }: { o: Order }) {
  const { openModal } = useTerminal();
  const toast = useToast();
  const side = orderSide(o);
  if (/cancelled|completed|settled/i.test(o.status)) return null;
  if (side === 'buy' && o.paymentStatus !== 'Paid')
    return (
      <>
        <Btn act="pay-start" onClick={() => openModal('pay-start', { orderId: o.id })}>
          Add credit
        </Btn>
        <Btn
          act="proc-payment"
          primary
          id={o.id}
          onClick={() => openModal('proc-payment', { id: o.id })}
        >
          Pay order
        </Btn>
      </>
    );
  if (side === 'sell') {
    if (['Awaiting buyer payment', 'Awaiting payment'].includes(o.status))
      return <p className="form-note">Awaiting verified buyer payment.</p>;
    const labels: Record<string, string> = {
      Paid: 'Start provisioning',
      Provisioning: 'Confirm delivery',
      Active: 'Complete service & settle',
    };
    return labels[o.status] ? (
      <Btn
        act="proc-seller-progress"
        primary
        id={o.id}
        onClick={() =>
          toast(
            'This action requires a verified backend transaction. Contact operations for assistance.',
          )
        }
      >
        {labels[o.status]}
      </Btn>
    ) : null;
  }
  return null;
}

export function OrderModal({ id }: { id?: string }) {
  const S = useBillingData();
  const { closeModal } = useTerminal();
  const toast = useToast();
  const o = S.orders.find((x) => x.id === id);
  if (!o)
    return (
      <p className="form-note">
        This order is not in the current account. Check the order ID or contact support.
      </p>
    );
  const total = orderAmount(o);
  const duration = /physical|hardware/i.test(String(o.kind || ''))
    ? 'One-time purchase'
    : o.hours
      ? o.hours + ' hours'
      : o.days
        ? o.days + ' days'
        : 'As agreed';
  const quantity =
    o.kind === 'model_capacity'
      ? o.inputMillion != null || o.outputMillion != null
        ? (o.inputMillion || 0) + 'M input / ' + (o.outputMillion || 0) + 'M output tokens'
        : 'As agreed in accepted quote'
      : (o.count || '—') + ' GPUs';
  const commission = orderCommission(S, o);
  const download = () => exportDownload(S, 'order', o.id, toast);
  return (
    <>
      <div className="bill-order-summary">
        <div>
          <h3>{o.title || o.model}</h3>
          <p>
            {o.status} · {o.paymentStatus || 'Unpaid'}
            {o.sample ? ' · Sample order' : ''}
          </p>
        </div>
        <strong>{usd(total)}</strong>
      </div>
      <div className="bill-detail-grid">
        <Detail label="Buyer" value={party(o.buyer, 'Not recorded')} />
        <Detail label="Supplier" value={party(o.seller, o.provider || 'Not recorded')} />
        <Detail label="Broker / agent" value={party(o.broker, 'Not involved')} />
        <Detail label="Resource" value={o.model || o.sku} />
        <Detail label="Quantity" value={quantity} />
        <Detail label="Region" value={o.region} />
        <Detail label="Market terms" value={o.term} />
        <Detail label="Duration" value={duration} />
        <Detail label="Trade method" value={o.tradeMethod || 'RFQ · accepted supplier quote'} />
        <Detail label="RFQ" value={o.rfqId} />
        <Detail label="Quote" value={o.quoteId} />
        <Detail label="Quote valid until" value={stamp(o.quoteValidUntil)} />
      </div>
      <h3 className="bill-section-title">Price breakdown</h3>
      <div className="bill-price-list">
        <OrderPricing o={o} />
        <OrderFeeRows o={o} />
        {commission != null ? (
          <Detail
            label={S.role === 'seller' ? 'Commission paid' : 'Commission earned'}
            value={usd(commission)}
          />
        ) : null}
        <Detail label="Payment method" value={o.paymentMethod || 'Not selected'} />
        <Detail label="Payment status" value={o.paymentStatus || 'Unpaid'} />
        <Detail
          label="Payment reference"
          value={o.paymentId || o.paymentReference || 'Not yet paid'}
        />
      </div>
      <OrderDelivery o={o} />
      <h3 className="bill-section-title">Order timeline</h3>
      <ol className="bill-timeline">
        {(o.audit?.length
          ? o.audit
          : [{ at: o.createdAt || o.created, event: 'Order created' }]
        ).map((e, i) => (
          <li key={i}>
            <span>{e.event}</span>
            <time>{stamp(e.at)}</time>
          </li>
        ))}
      </ol>
      <div className="modal-footer">
        <OrderActions o={o} />
        <Btn act="bill-export" value="order" id={o.id} onClick={download}>
          Download order
        </Btn>
        <Btn act="close-modal" onClick={closeModal}>
          Close
        </Btn>
      </div>
    </>
  );
}

function exportDownload(
  S: BillingData,
  type: string,
  id: string | undefined,
  toast: (m: string) => void,
) {
  const rows = exportRows(S, type, id);
  if (!rows.length) return toast('No records to export in this period');
  downloadText('OpenNEXT-' + type + '.csv', csv(rows), 'text/csv;charset=utf-8');
}

function Measurement() {
  const role = useWorkspaceStore((s) => s.role);
  return (
    <>
      <div className="callout">
        Spending comes from posted account charges, not GPU utilization estimates. Credit additions
        and withdrawals are excluded from operating spend.
      </div>
      <div className="bill-detail-grid">
        <Detail label="Reserved GPU-hours" value="Paid GPU count × contracted hours" />
        <Detail label="Metered GPU-hours" value="Usage recorded by your resource provider" />
        <Detail
          label="Utilization"
          value="Metered / reserved GPU-hours; only when coverage is complete"
        />
        <Detail
          label="Earnings"
          value="Net settled sale proceeds, after the recorded OpenNEXT fee; excludes top-ups"
        />
        <Detail
          label={FEE_LABEL}
          value="Buyer: base order amount + 5%. Seller: base order amount − 5%. Top-ups are not charged this order fee."
        />
        <Detail label="Trading margin" value="Sales revenue minus purchase charges" />
        <Detail
          label={role === 'seller' ? 'Commission paid' : 'Commission earned'}
          value={
            role === 'seller'
              ? 'Broker fees are negative expenses'
              : 'Broker fees, reported separately'
          }
        />
      </div>
      <p className="form-note">
        Provider telemetry and actual payment processing will be connected separately. Unknown
        values remain unavailable rather than being estimated as fact.
      </p>
    </>
  );
}

function CashoutStart() {
  const { closeModal } = useTerminal();
  const { earnings } = useBalance();
  return (
    <>
      <div className="pay-summary">
        <span>Available to withdraw</span>
        <strong>{usd(earnings)}</strong>
      </div>
      <p className="form-note">
        Payout processing is not configured yet. Contact your OpenNEXT account team to arrange a
        verified payout. Promotional credit and prepaid purchasing credit cannot be withdrawn.
      </p>
      <div className="modal-footer">
        <Btn act="close-modal" onClick={closeModal}>
          Close
        </Btn>
      </div>
    </>
  );
}

function CashoutDetail({ payout }: { payout: Payout }) {
  const { closeModal } = useTerminal();
  return (
    <>
      <div className="bill-detail-grid">
        <Detail label="Amount" value={usd(payout.amount)} />
        <Detail label="Status" value={payout.status} />
        <Detail label="Destination" value={payout.destination} />
        <Detail label="Beneficiary" value={payout.beneficiary} />
        <Detail label="Requested" value={stamp(payout.createdAt)} />
        <Detail label="Completed" value={stamp(payout.paidAt)} />
      </div>
      <p className="form-note">
        Payout status is confirmed by the payment service. It cannot be changed from this page.
      </p>
      <div className="modal-footer">
        <Btn act="close-modal" onClick={closeModal}>
          Close
        </Btn>
      </div>
    </>
  );
}

function RecordModal({ l }: { l: LedgerEntry }) {
  const S = useBillingData();
  const toast = useToast();
  const identity = useWorkspaceStore((s) => s.identity);
  return (
    <>
      {l.test ? (
        <div className="bill-test-notice">
          <strong>Test transaction</strong>No real funds were charged or transferred.
        </div>
      ) : null}
      <div className="bill-detail-grid">
        <Detail label="Description" value={ledgerLabel(S.role, l)} />
        <Detail label="Amount" value={usd(ledgerAmount(S.role, l))} />
        <Detail label="Status" value={l.status || 'Posted'} />
        <Detail label="Date" value={stamp(l.createdAt || l.date)} />
        <Detail label="Account" value={identity.email} />
        <Detail label="Payment method" value={l.paymentMethod || 'Not recorded'} />
        <Detail label="Destination" value={l.destination || 'Not applicable'} />
        <Detail label="Transaction ID" value={l.paymentId || l.id} />
      </div>
      <div className="modal-footer">
        <Btn
          act="bill-export"
          value="record"
          id={l.id}
          onClick={() => exportDownload(S, 'record', l.id, toast)}
        >
          Download record
        </Btn>
      </div>
    </>
  );
}

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'bill-order': { id: string };
    'bill-measurement': Record<string, never>;
    'pay-start': { orderId?: string; purchaseReference?: string; spotCheckout?: boolean };
    topup: { orderId?: string; purchaseReference?: string; spotCheckout?: boolean };
    'pay-checkout': { orderId?: string; purchaseReference?: string; spotCheckout?: boolean };
    'payment-method': Record<string, never>;
    'payment-topup-status': { id: string };
    'payment-provider': Record<string, never>;
    'cashout-start': Record<string, never>;
    'cashout-detail': { id: string };
    'bill-record': { id: string };
    receipt: { id: string };
  }
}

const BillOrderModal: ModalComponent<'bill-order'> = ({ modal, close }) => {
  const S = useBillingData();
  const id = modal.id;
  return (
    <ModalFrame
      title={S.orders.some((o) => o.id === id) ? 'Order details · ' + id : 'Order unavailable'}
      wide
      close={close}
    >
      <OrderModal id={id} />
    </ModalFrame>
  );
};

const MeasurementModal: ModalComponent<'bill-measurement'> = ({ close }) => (
  <ModalFrame title="How reporting is measured" close={close}>
    <Measurement />
  </ModalFrame>
);

const PayStartModal: ModalComponent<'pay-start' | 'topup' | 'pay-checkout'> = ({
  modal,
  close,
}) => (
  <ModalFrame title="Add credit" close={close}>
    <PaymentAmount
      orderId={modal.orderId}
      purchaseReference={modal.purchaseReference}
      spotCheckout={modal.spotCheckout === true}
    />
  </ModalFrame>
);

const PaymentMethodModal: ModalComponent<'payment-method'> = ({ close }) => (
  <ModalFrame title="Choose payment method" close={close}>
    <PaymentMethod />
  </ModalFrame>
);

const TopupStatusModal: ModalComponent<'payment-topup-status'> = ({ modal, close }) => (
  <ModalFrame title={<TopupStatus.Title id={modal.id} />} close={close}>
    <TopupStatus id={modal.id} />
  </ModalFrame>
);

const PaymentProviderModal: ModalComponent<'payment-provider'> = ({ close }) => (
  <ModalFrame title="Complete your credit top-up" close={close}>
    <PaymentProvider />
  </ModalFrame>
);

const CashoutStartModal: ModalComponent<'cashout-start'> = ({ close }) => (
  <ModalFrame title="Cash out earnings" close={close}>
    <CashoutStart />
  </ModalFrame>
);

const CashoutDetailModal: ModalComponent<'cashout-detail'> = ({ modal, close }) => {
  const S = useBillingData();
  const payout = S.payouts.find((item) => item.id === modal.id);
  if (!payout) return null;
  return (
    <ModalFrame title={'Payout details · ' + payout.id} close={close}>
      <CashoutDetail payout={payout} />
    </ModalFrame>
  );
};

const RecordDetailModal: ModalComponent<'bill-record' | 'receipt'> = ({ modal, close }) => {
  const S = useBillingData();
  const l = S.ledger.find((x) => x.id === modal.id);
  if (!l) return null;
  if (l.orderId)
    return (
      <ModalFrame title={'Order details · ' + l.orderId} wide close={close}>
        <OrderModal id={l.orderId} />
      </ModalFrame>
    );
  return (
    <ModalFrame title={'Activity details · ' + l.id} close={close}>
      <RecordModal l={l} />
    </ModalFrame>
  );
};

/** Modals owned by billing and payments (legacy `OpenNEXTBilling.modal` + `OpenNEXTPayments.modal`). */
export const billingModals: ModalComponents = {
  'bill-order': BillOrderModal,
  'bill-measurement': MeasurementModal,
  'pay-start': PayStartModal,
  topup: PayStartModal,
  'pay-checkout': PayStartModal,
  'payment-method': PaymentMethodModal,
  'payment-topup-status': TopupStatusModal,
  'payment-provider': PaymentProviderModal,
  'cashout-start': CashoutStartModal,
  'cashout-detail': CashoutDetailModal,
  'bill-record': RecordDetailModal,
  receipt: RecordDetailModal,
};
