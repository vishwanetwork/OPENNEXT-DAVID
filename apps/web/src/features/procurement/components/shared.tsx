'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { MarketRow, OwnedRfq, Quote } from '@opennext/contracts';
import { money } from '@/lib/format';
import { FEE_LABEL, currentFees, sellerEstimate } from '../fees';
import { isHardware, isModel, type MarketSide } from '../exchange';
import { useIsDemo, type Role } from '@/terminal-kit';

/** `18 Oct 2026, 08:00 UTC` (legacy procurement `date()`); "To be confirmed" when empty. */
export const date = (v: unknown): string =>
  v
    ? new Date(String(v)).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }) + ' UTC'
    : 'To be confirmed';
export const isoInput = (v?: unknown): string =>
  new Date(v ? (typeof v === 'number' ? v : String(v)) : Date.now() + 86400000)
    .toISOString()
    .slice(0, 16);

export const volume = (r: {
  kind?: unknown;
  inputMillion?: unknown;
  outputMillion?: unknown;
  count?: unknown;
  hours?: unknown;
}): string =>
  isModel(r)
    ? `${r.inputMillion || 0}M input / ${r.outputMillion || 0}M output`
    : isHardware(r)
      ? `${r.count} GPUs · physical delivery`
      : `${r.count} GPU · ${r.hours} hours`;
export const deliveryTime = (minutes: unknown, r: { kind?: unknown }): string =>
  isHardware(r) ? `${Math.ceil(Number(minutes) / 1440)} days` : `${minutes} min`;
export const numberLabel = (value: unknown): string => Number(value).toLocaleString('en-US');

/** Legacy `btn()` — `.btn.secondary.small` by default, primary when `primary`. */
export function PBtn({
  primary = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; children: ReactNode }) {
  return (
    <button
      type={type}
      className={`btn ${primary ? '' : 'secondary'} small ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Tag = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <span className={`tag ${className}`.trim()}>{children}</span>
);

export function Field({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <small>{label}</small>
      <strong>
        {value === null || value === undefined || value === '' ? 'To be confirmed' : value}
      </strong>
    </div>
  );
}

export const FieldList = ({ items }: { items: [ReactNode, ReactNode][] }) => (
  <>
    {items.map(([label, value], i) => (
      <Field key={i} label={label} value={value} />
    ))}
  </>
);

/* ---------- Fees ---------- */

export function FeeBreakdown({
  record,
  side = 'buy',
}: {
  record: Partial<Quote> | null | undefined;
  side?: 'buy' | 'sell';
}) {
  if (!currentFees(record))
    return (
      <>
        <div className="details-grid">
          <Field
            label="Recorded order amount"
            value={money(record?.total ?? (record as { amount?: unknown } | undefined)?.amount)}
          />
        </div>
        <p className="form-note">
          The recorded amount is unchanged. A separate fee breakdown is not available for this
          record.
        </p>
      </>
    );
  const seller = side === 'sell';
  return (
    <>
      <div className="details-grid proc-fee-breakdown">
        <Field label="Base order amount" value={money(record.subtotal)} />
        <Field
          label={FEE_LABEL}
          value={(seller ? '−' : '+') + money(seller ? record.sellerFee : record.buyerFee)}
        />
        <Field
          label={seller ? 'Net proceeds' : 'Total payable'}
          value={money(seller ? record.sellerNet : record.buyerTotal)}
        />
      </div>
      <p className="form-note">
        {seller
          ? 'The seller fee is deducted from the base order amount at settlement.'
          : 'The buyer fee is added to the base order amount at checkout.'}{' '}
        The listed unit price is unchanged.
      </p>
    </>
  );
}

/** Live seller settlement estimate (`data-proc-fee-estimate`). */
export function SellerEstimate({
  rate,
  count,
  hours,
}: {
  rate: unknown;
  count: unknown;
  hours: unknown;
}) {
  const estimate = sellerEstimate(rate, count, hours);
  const show = (key: 'base' | 'fee' | 'net') =>
    estimate.valid ? (key === 'fee' ? '−' : '') + '$' + estimate[key].toFixed(2) : '—';
  return (
    <section
      className="full proc-fee-estimate"
      data-proc-fee-estimate
      data-count={String(count ?? '')}
      data-hours={String(hours ?? '')}
      aria-live="polite"
    >
      <p className="form-note">Estimated settlement · based on the quoted quantity and duration</p>
      <div className="details-grid">
        <div>
          <small>Base order amount</small>
          <strong data-proc-estimate-base>{show('base')}</strong>
        </div>
        <div>
          <small>{FEE_LABEL}</small>
          <strong data-proc-estimate-fee>{show('fee')}</strong>
        </div>
        <div>
          <small>Estimated net proceeds</small>
          <strong data-proc-estimate-net>{show('net')}</strong>
        </div>
      </div>
    </section>
  );
}

/* ---------- Receipts ---------- */

export interface Receipt {
  receiptId: string;
  receivedAt: string;
  revision?: number;
  status: string;
}

export const receiptFor = (record: { submission?: unknown } | null | undefined): Receipt | null => {
  const submission = record?.submission as Partial<Receipt> | undefined;
  return submission?.status === 'Received' &&
    typeof submission.receiptId === 'string' &&
    submission.receiptId.trim().length > 0 &&
    Number.isFinite(Date.parse(String(submission.receivedAt)))
    ? (submission as Receipt)
    : null;
};

export function ReceiptDetails({
  record,
}: {
  record: { submission?: unknown } | null | undefined;
}) {
  const demo = useIsDemo();
  const receipt = receiptFor(record);
  if (!receipt) return null;
  return (
    <section className="callout">
      <strong>{demo ? 'Demo submission received' : 'Received by OpenNEXT operations'}</strong>
      <p className="form-note">
        {receipt.receiptId} · {date(receipt.receivedAt)} · Revision {receipt.revision || 1}
      </p>
      <p className="form-note">
        Receipt confirms submission, not approval, publication or payment.
      </p>
    </section>
  );
}

/* ---------- RFQ status ---------- */

export function rfqStatus(r: Pick<OwnedRfq, 'reviewStatus' | 'status' | 'visibility'>): string {
  return r.reviewStatus === 'Approved' && ['Open', 'Quoted'].includes(r.status)
    ? r.visibility === 'Private RFQ'
      ? 'Approved · Private RFQ'
      : 'Live RFQ'
    : r.status;
}

export function RfqReviewNote({ r }: { r: OwnedRfq }) {
  if (r.status === 'Reviewing')
    return (
      <div className="callout proc-reviewing">
        Reviewing · Operations is reviewing your RFQ. It is not visible in the public market yet.
        You will receive a notification when the decision is ready.
      </div>
    );
  if (r.status === 'Rejected')
    return (
      <div className="callout">
        Not approved ·{' '}
        {r.reviewReason || 'Review the requirements and resubmit for operations approval.'}
      </div>
    );
  if (r.reviewStatus === 'Approved')
    return (
      <p className="form-note">
        Operations approved this RFQ{r.reviewedAt ? ' on ' + date(r.reviewedAt) : ''}.{' '}
        {r.visibility === 'Private RFQ'
          ? 'It remains private to the selected supplier.'
          : 'It is available in the market while open.'}
      </p>
    );
  return null;
}

/* ---------- External (sourced) rows ---------- */

export const externalName = (row: { side?: unknown } | null | undefined): string =>
  row?.side === 'supply' ? 'Sourced offer' : 'Sourced requirement';
export const externalNotice = (row?: { side?: unknown } | null): string =>
  (row ? externalName(row) : 'Sourced listings') +
  '. Availability and commercial terms are confirmed through OpenNEXT.';
export const canInquire = (role: Role, row: { side?: unknown } | null | undefined): boolean =>
  row?.side === 'supply' ? role === 'buyer' : role === 'seller';
export const rowPrice = (r: { price?: unknown }): string =>
  r.price == null ? 'To confirm' : money(r.price);

export function externalQuantity(row: MarketRow): string {
  const q = row.quantity || {};
  const parts: string[] = [];
  if (q.nodes != null)
    parts.push(numberLabel(q.nodes) + ' ' + (Number(q.nodes) === 1 ? 'node' : 'nodes'));
  else if (q.minNodes != null && q.maxNodes != null)
    parts.push(numberLabel(q.minNodes) + '–' + numberLabel(q.maxNodes) + ' nodes');
  else if (q.minNodes != null) parts.push(numberLabel(q.minNodes) + '+ nodes');
  else if (q.maxNodes != null) parts.push('Up to ' + numberLabel(q.maxNodes) + ' nodes');
  if (q.totalGpus != null) parts.push(numberLabel(q.totalGpus) + ' GPUs');
  else if (q.totalGpusMin != null && q.totalGpusMax != null)
    parts.push(numberLabel(q.totalGpusMin) + '–' + numberLabel(q.totalGpusMax) + ' GPUs');
  else if (q.totalGpusMin != null) parts.push(numberLabel(q.totalGpusMin) + '+ GPUs');
  else if (q.totalGpusMax != null) parts.push('Up to ' + numberLabel(q.totalGpusMax) + ' GPUs');
  else if (!parts.length && row.count != null) parts.push(numberLabel(row.count) + ' GPUs');
  return parts.join(' · ') || 'Quantity to confirm';
}

export function externalCommitment(row: MarketRow): string {
  const term = row.rentalMonths || {};
  const options = (term.options || []).filter((value) => Number(value) > 0);
  const months = options.length
    ? options.map(numberLabel).join(' / ')
    : term.min != null && term.max != null
      ? Number(term.min) === Number(term.max)
        ? numberLabel(term.min)
        : numberLabel(term.min) + '–' + numberLabel(term.max)
      : term.min != null
        ? 'From ' + numberLabel(term.min)
        : term.max != null
          ? 'Up to ' + numberLabel(term.max)
          : '';
  return 'Commitment · ' + (months ? months + ' months' : 'Term to confirm');
}

export const sideOf = (row: MarketRow): MarketSide => (row.side === 'demand' ? 'demand' : 'supply');
