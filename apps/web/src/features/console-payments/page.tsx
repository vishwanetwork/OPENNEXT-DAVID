'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import type { PaymentReviewKind, PaymentReviewService } from '@/lib/payment-review';
import { usePaymentReviewQueue } from './hooks';
import { reviewable } from './validation';
import { PaymentDecisionDialog } from './decision-dialog';
import { PaymentRequestTable } from './request-table';
import { PaymentDetails } from './request-details';
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
      [row.email, row.id, row.reference, row.orderId, row.accountNumber]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = rows.find((row) => row.id === selection?.id);
  const title = kind === 'topup' ? 'Top-up Requests' : 'Payment Requests';
  const close = () => setSelection(null);
  return (
    <section className="payment-review">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p>
            {kind === 'topup'
              ? 'Verify incoming payments and add the full received amount as Credit. Top-ups have no fee.'
              : 'Verify bank receipts, recheck the original resource and notify the customer.'}
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
      {kind === 'direct_pay' &&
        service &&
        (!service.completeDirectPay ||
          rows.some((row) => row.status === 'Pending' && !row.offerId)) && (
          <p className="payment-review-state" role="status">
            Completed is unavailable until the backend supports original-resource rechecks and
            paid-purchase continuation or full Credit conversion. Failed requests can still be
            processed. No automatic purchase will be triggered by this page.
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
              placeholder="Account, email, order or reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {['All', 'Pending', 'Confirmed', 'Failed'].map((value) => (
                <option key={value} value={value}>
                  {value === 'Confirmed' ? 'Completed' : value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PaymentRequestTable
          kind={kind}
          rows={visible}
          service={service}
          onSelect={(id, action) => setSelection({ id, action })}
        />
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
            onConfirmed={(receipt) => {
              close();
              toast(
                receipt.status === 'Failed'
                  ? 'Failed. The reason has been queued for the customer notification and email.'
                  : kind === 'topup'
                    ? 'Top-up completed. Credit has been added; notification and email have been queued.'
                    : receipt.directPayResolution?.outcome === 'credited'
                      ? 'Payment completed. The resource is unavailable; the full payment was added as Credit. Notification and email have been queued.'
                      : 'Payment completed. Notification and email include the next step to complete the original paid purchase.',
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
