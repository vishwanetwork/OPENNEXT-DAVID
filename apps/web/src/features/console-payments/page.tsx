'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import { money, stampUtc } from '@/lib/format';
import type {
  PaymentReviewKind,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';
import { usePaymentReviewQueue } from './hooks';
import { reviewable } from './validation';
import { PaymentDecisionDialog } from './decision-dialog';
import './payment-review.css';

export function PaymentReviewQueue({
  kind,
  service,
}: {
  kind: PaymentReviewKind;
  service?: PaymentReviewService;
}) {
  const scope = service?.sessionScope;
  const [binding, setBinding] = useState({ service, scope, generation: 0 });
  if (binding.service !== service || binding.scope !== scope) {
    setBinding({ service, scope, generation: binding.generation + 1 });
    return null;
  }
  return (
    <Queue
      key={JSON.stringify([scope, kind, binding.generation])}
      kind={kind}
      service={typeof scope === 'string' && scope.trim() ? service : undefined}
    />
  );
}

function Queue({ kind, service }: { kind: PaymentReviewKind; service?: PaymentReviewService }) {
  const [blocked, setBlocked] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [selection, setSelection] = useState<{
    id: string;
    action: 'Details' | 'Confirm' | 'Fail';
  } | null>(null);
  const queue = usePaymentReviewQueue(kind, service, blocked);
  const unauthorized = isUnauthorized(queue.error);
  const toast = useToast();
  const clear = queue.clear;
  useEffect(() => {
    if (blocked) clear();
  }, [blocked, clear]);
  if (unauthorized && !blocked) {
    setBlocked(true);
    return null;
  }
  const rows = blocked || queue.error ? [] : (queue.data ?? []);
  const visible = rows.filter(
    (row) =>
      (status === 'All' || row.status === status) &&
      [row.email, row.id, row.reference, row.orderId]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = rows.find((row) => row.id === selection?.id);
  const title = kind === 'topup' ? 'Bank transfer top-up requests' : 'Payment Requests';
  const close = () => setSelection(null);
  return (
    <section className="payment-review">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p>
            {kind === 'topup'
              ? 'Verify incoming payments and add the full received amount as Credit. Top-ups have no fee.'
              : 'Confirm bank receipts and queue Direct Pay provisioning.'}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!service || blocked || queue.isFetching}
          onClick={() => void queue.refetch()}
        >
          Refresh
        </button>
      </header>
      {!service && (
        <p className="payment-review-state" role="status">
          Awaiting backend · Verified payment decisions, account updates, notifications and emails
          are not connected. No payment can be approved here yet.
        </p>
      )}
      {(queue.error || blocked) && (
        <p className="payment-review-error" role="alert">
          {blocked || unauthorized
            ? 'Administrator access expired. Sign in again to view payment records.'
            : describeError(queue.error).message}
        </p>
      )}
      <section className="panel">
        <div className="payment-review-toolbar">
          <label>
            Search
            <input
              type="search"
              placeholder="Email, request or payment reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {['All', 'Pending', 'Confirmed', 'Failed'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Email',
                  'Received amount',
                  ...(kind === 'topup' ? ['Credit'] : ['Order']),
                  'Reference',
                  'Submitted',
                  'Status',
                  'Actions',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id}>
                  <td>{record.email}</td>
                  <td>{money(record.amountCents / 100)}</td>
                  {kind === 'topup' ? (
                    <>
                      <td>
                        {record.creditAmountCents === undefined
                          ? '—'
                          : money(record.creditAmountCents / 100)}
                      </td>
                    </>
                  ) : (
                    <td>{record.orderId ?? '—'}</td>
                  )}
                  <td>{record.reference}</td>
                  <td>{stampUtc(record.submittedAt)}</td>
                  <td>{record.status}</td>
                  <td>
                    <div className="payment-review-actions">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setSelection({ id: record.id, action: 'Details' })}
                      >
                        Details
                      </button>
                      {record.status === 'Pending' && (
                        <>
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={!reviewable(record)}
                            onClick={() => setSelection({ id: record.id, action: 'Confirm' })}
                          >
                            {kind === 'topup' ? 'Add Credit' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="btn small"
                            disabled={!reviewable(record)}
                            onClick={() => setSelection({ id: record.id, action: 'Fail' })}
                          >
                            Fail
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="payment-review-empty">
            {!service
              ? 'Payment service awaiting backend'
              : queue.isLoading
                ? 'Loading payment requests…'
                : 'No matching payment requests'}
          </div>
        )}
      </section>
      {selected && selection?.action === 'Details' && (
        <PaymentDetails record={selected} onClose={close} />
      )}
      {selected &&
        service &&
        selection &&
        selection.action !== 'Details' &&
        reviewable(selected) && (
          <PaymentDecisionDialog
            key={`${selected.id}:${selected.revision}:${selected.status}:${selection.action}`}
            record={selected}
            decision={selection.action}
            service={service}
            onClose={close}
            onConfirmed={() => {
              close();
              toast(
                kind === 'topup'
                  ? 'Decision confirmed. Account notification and email have been queued.'
                  : 'Decision confirmed. Provisioning is queued when approved; account notification and email have been queued.',
              );
              void queue.refetch();
            }}
            onRefresh={() => {
              close();
              void queue.refetch();
            }}
            onAccessDenied={() => {
              close();
              setBlocked(true);
              queue.clear();
            }}
          />
        )}
    </section>
  );
}

function PaymentDetails({ record, onClose }: { record: PaymentReviewRecord; onClose: () => void }) {
  return (
    <Dialog
      overlayClassName="payment-review-overlay"
      className="payment-review-dialog"
      label="Payment request details"
      onClose={onClose}
    >
      <h2>Payment request details</h2>
      <dl>
        {[
          ['Email', record.email],
          ['Request', record.id],
          ['Order', record.orderId ?? '—'],
          ['Received amount', money(record.amountCents / 100)],
          ['Pricing basis', record.pricingVersion],
          ['Reference', record.reference],
          ['Submitted', stampUtc(record.submittedAt)],
          ['Status', record.status],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!reviewable(record) && record.status === 'Pending' && (
        <p className="payment-review-state">
          This record needs a verified, versioned payment basis before review. Legacy amounts are
          not re-priced or charged a second fee.
        </p>
      )}
      <footer>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </footer>
    </Dialog>
  );
}
