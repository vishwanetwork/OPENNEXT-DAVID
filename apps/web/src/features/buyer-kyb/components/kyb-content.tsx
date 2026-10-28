'use client';

import { useEffect, useRef, useState } from 'react';
import type { BuyerKybReturn } from '@/lib/buyer-kyb';
import { useTerminal, useTerminalSlots } from '@/terminal-kit';
import { useBuyerKyb } from '../hooks';
import { KybForm } from './kyb-form';
import type { TopupReturnIntent } from '../return-intent';
import '../buyer-kyb.css';

export function BuyerKybContent({
  returnTo,
  topupReturn,
}: {
  returnTo?: BuyerKybReturn;
  topupReturn?: TopupReturnIntent;
}) {
  const kyb = useBuyerKyb();
  const { go, openModal, closeModal } = useTerminal();
  const purchase = useTerminalSlots().services.purchaseContext;
  const [resubmitting, setResubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const changedAccount = Boolean(topupReturn && topupReturn.identity !== kyb.identity);
  useEffect(() => {
    if (changedAccount) closeModal();
  }, [changedAccount, closeModal]);
  if (changedAccount)
    return <p>This payment request belongs to a previous session. Start again from Billing.</p>;
  const record = kyb.snapshot?.verification;
  if (!record || (record.status === 'Rejected' && resubmitting)) {
    return (
      <div className="buyer-kyb">
        {kyb.connected && kyb.query.isLoading && (
          <p className="buyer-kyb-notice" role="status">
            Checking your KYB status…
          </p>
        )}
        {kyb.query.isError && (
          <div className="buyer-kyb-notice" role="alert">
            Your KYB status could not be verified. Payment remains unavailable.
            <button
              className="btn secondary small"
              type="button"
              onClick={() => void kyb.query.refetch()}
            >
              Retry status check
            </button>
          </div>
        )}
        <KybForm key={`${kyb.identity}:${record?.id ?? 'new'}`} />
      </div>
    );
  }
  const resume = async () => {
    setChecking(true);
    setError('');
    const stillApproved = await kyb.refreshApproved();
    if (!alive.current) return;
    if (!stillApproved) {
      setChecking(false);
      setError(
        'We could not verify your approval. Please refresh your KYB status before continuing.',
      );
      return;
    }
    if (returnTo === 'spot' && purchase?.hasPending()) openModal('spot-review');
    else if (returnTo === 'topup')
      openModal(
        'pay-start',
        topupReturn?.identity === kyb.identity
          ? topupReturn.context
          : {
              spotCheckout: purchase?.hasPending() ?? false,
              purchaseReference: purchase?.hasPending() ? purchase.reference() : undefined,
            },
      );
    else go(returnTo === 'spot' ? 'market' : 'billing');
  };
  const approved = record.status === 'Approved';
  const rejected = record.status === 'Rejected';
  return (
    <div className="buyer-kyb">
      <section
        className={`buyer-kyb-state ${approved ? 'is-approved' : ''}`}
        aria-label="Buyer KYB status"
      >
        <span className="buyer-kyb-status">{record.status}</span>
        <h3>
          {approved
            ? 'Your business is verified.'
            : rejected
              ? 'Your KYB needs attention.'
              : 'Your KYB is under review.'}
        </h3>
        <p>
          {approved
            ? 'KYB has been approved. You can continue to bank transfer instructions for your credit top-up or purchase.'
            : rejected
              ? 'The review was not approved. Check your private notifications for the reason provided by the OpenNEXT review team, then submit updated information.'
              : 'Your documents have been submitted for OpenNEXT business verification. We will notify you when a decision is available.'}
        </p>
        <dl>
          <div>
            <dt>Company</dt>
            <dd>{record.company.companyName}</dd>
          </div>
          <div>
            <dt>Review route</dt>
            <dd>{record.mode}</dd>
          </div>
        </dl>
        {error && (
          <p className="buyer-kyb-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={closeModal}>
            Close
          </button>
          {rejected && (
            <>
              <button type="button" className="btn secondary" onClick={() => go('notifications')}>
                View notifications
              </button>
              <button type="button" className="btn" onClick={() => setResubmitting(true)}>
                Resubmit KYB
              </button>
            </>
          )}
          {approved && (
            <button type="button" className="btn" disabled={checking} onClick={() => void resume()}>
              {checking
                ? 'Checking approval…'
                : returnTo === 'topup'
                  ? 'Continue to add credit'
                  : returnTo === 'spot'
                    ? 'Back to purchase'
                    : 'Continue to billing'}
            </button>
          )}
          {!approved && !rejected && (
            <button
              type="button"
              className="btn secondary"
              disabled={kyb.query.isFetching}
              onClick={() => void kyb.query.refetch()}
            >
              {kyb.query.isFetching ? 'Checking…' : 'Refresh status'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
