'use client';

import type { Order } from '@opennext/contracts';
import { useToast } from '@/components/ui/toast';
import { useTerminal } from '@/terminal-kit';
import {
  FEE_LABEL,
  currentFees,
  num,
  orderAmount,
  orderSide,
  stamp,
  tokenUsd,
  usd,
} from '../analytics';
import { Detail } from './billing-page';
import { Btn } from './billing-modals';

export const party = (value: unknown, fallback: string) =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? [
          (value as { company?: string }).company,
          (value as { name?: string }).name,
          (value as { email?: string }).email,
        ]
          .filter(Boolean)
          .join(' ') || fallback
      : fallback;

export function OrderFeeRows({ o }: { o: Order }) {
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
          label={seller ? 'Net proceeds (USD)' : 'Total payable (USD)'}
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
        label={seller ? 'Recorded proceeds (USD)' : 'Recorded order total (USD)'}
        value={usd(orderAmount(o))}
      />
      <p className="form-note">
        Historical order amounts are unchanged. No new fee has been applied to this record.
      </p>
    </>
  );
}

export function OrderPricing({ o }: { o: Order }) {
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

export function OrderDelivery({ o }: { o: Order }) {
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
          value={o.deliveryMethod || (physical ? 'Shipment to be confirmed' : 'To be confirmed')}
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

export function OrderActions({ o }: { o: Order }) {
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
