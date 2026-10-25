'use client';

import { useToast } from '@/components/ui/toast';
import { useTerminal } from '@/terminal-kit';
import { useBillingData } from '../hooks';
import { orderAmount, orderCommission, stamp, usd } from '../analytics';
import { Detail } from './billing-page';
import { Btn } from './billing-modals';
import { exportDownload } from './billing-dialogs';
import { OrderActions, OrderDelivery, OrderFeeRows, OrderPricing, party } from './order-sections';

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
