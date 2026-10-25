'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/errors';
import { useRefreshBillingAccount, useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { usd } from '../analytics';
import { useOwnTopups, usePaymentIdentity } from '../hooks';
import { hasPendingTopup, safeCheckoutUrl, usePaymentStore } from '../payments';
import { Btn } from './payment-ui';

export function TopupStatus({ id }: { id?: string }) {
  const { closeModal } = useTerminal();
  const toast = useToast();
  const refreshBillingAccount = useRefreshBillingAccount();
  const topups = useOwnTopups();
  const request = topups.find(id);
  const [error, setError] = useState('');
  const refresh = () =>
    refreshBillingAccount().catch((e: unknown) => {
      const { message } = describeError(e);
      setError(message);
      toast(message);
    });
  const returnToPurchase = async () => {
    const reference = topups.purchaseReference();
    if (!topups.canReturn(request))
      return toast('This top-up is not linked to an approved purchase return.');
    try {
      const account = await refreshBillingAccount();
      if (!account || topups.purchaseReference() !== reference) return;
      const confirmed = account.requests.find((row) => row.id === id);
      if (!topups.canReturn(confirmed))
        throw new Error('This top-up has not been confirmed for the current purchase.');
      topups.resumePurchase();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (!request)
    return (
      <>
        <p className="form-note">
          This top-up request is unavailable. Refresh your account or check your notifications.
        </p>
        <div className="modal-footer">
          <Btn act="payment-refresh-status" onClick={refresh}>
            Refresh
          </Btn>
          <Btn act="close-modal" primary onClick={closeModal}>
            Close
          </Btn>
        </div>
      </>
    );
  const approved = request.status === 'Approved';
  const rejected = request.status === 'Rejected';
  const message = approved
    ? usd(request.amount) + ' has been credited to your account.'
    : rejected
      ? 'Your ' + usd(request.amount) + ' top-up was not approved. No credit was added.'
      : 'Your ' +
        usd(request.amount) +
        ' top-up request has been received and is awaiting payment verification. We will notify you when the review is complete.';
  return (
    <>
      <div className="pay-summary">
        <span>Credit top-up</span>
        <strong>{usd(request.amount)}</strong>
      </div>
      <p className="form-note" role="status">
        {message}
      </p>
      {rejected && request.reason ? <p className="form-note">{request.reason}</p> : null}
      <div className="payment-error form-note" role="alert" hidden={!error}>
        {error}
      </div>
      <div className="modal-footer">
        {topups.canReturn(request) ? (
          <Btn act="payment-return-purchase" id={request.id} onClick={returnToPurchase}>
            Back to purchase
          </Btn>
        ) : null}
        <Btn act="close-modal" primary onClick={closeModal}>
          Done
        </Btn>
      </div>
    </>
  );
}
TopupStatus.Title = function TopupStatusTitle({ id }: { id?: string }) {
  const request = useOwnTopups().find(id);
  return (
    <>
      {!request
        ? 'Top-up status'
        : request.status === 'Approved'
          ? 'Credit added.'
          : request.status === 'Rejected'
            ? 'Top-up not approved.'
            : 'Top-up in progress.'}
    </>
  );
};

export function PaymentProvider() {
  const { openModal } = useTerminal();
  const draft = usePaymentStore((s) => s.draft);
  let url = '';
  try {
    url = safeCheckoutUrl((draft as { checkoutUrl?: unknown } | null)?.checkoutUrl);
  } catch {
    return (
      <p className="form-note">A secure payment link is not available. No credit has been added.</p>
    );
  }
  return (
    <>
      <div className="pay-summary">
        <span>Credit top-up</span>
        <strong>{usd(draft?.amount)}</strong>
      </div>
      <p className="form-note">
        Continue in the payment provider&apos;s secure checkout. Your balance changes only after
        confirmed payment.
      </p>
      <div className="modal-footer">
        <Btn act="payment-method-back" onClick={() => openModal('payment-method')}>
          Back
        </Btn>
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
          Open secure checkout
        </a>
      </div>
    </>
  );
}

/** Polls the credit account every 10 s while a top-up is pending, and on focus / visibility. */
export function useTopupPolling() {
  const owner = usePaymentIdentity();
  const { requests } = useOwnTopups();
  const refreshBillingAccount = useRefreshBillingAccount();
  const modalType = useWorkspaceStore((s) => s.modal?.type);
  const pending = hasPendingTopup(requests);
  useEffect(() => {
    const quiet = () => {
      if (!owner || document.hidden || (!pending && modalType !== 'payment-topup-status')) return;
      refreshBillingAccount().catch(() => {});
    };
    window.addEventListener('focus', quiet);
    document.addEventListener('visibilitychange', quiet);
    const timer = pending ? setInterval(quiet, 10000) : null;
    return () => {
      window.removeEventListener('focus', quiet);
      document.removeEventListener('visibilitychange', quiet);
      if (timer) clearInterval(timer);
    };
  }, [owner, pending, modalType, refreshBillingAccount]);
}

/** Headless component mounted by the composition root: keeps pending top-ups polling. */
export function BillingPolling() {
  useTopupPolling();
  return null;
}
export { PaymentAmount } from './payment-flow';
export { PaymentMethod } from './payment-flow';
