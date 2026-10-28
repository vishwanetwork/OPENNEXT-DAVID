'use client';

import type { ReactNode } from 'react';
import { AccountIcons } from '@/components/icons';
import type { BuyerKybReturn } from '@/lib/buyer-kyb';
import { useOpenModal } from '@/terminal-kit';
import { useBuyerKyb } from '../hooks';
import type { TopupContext } from '../return-intent';
import '../buyer-kyb.css';

export function BuyerKybButton({ returnTo }: { returnTo?: BuyerKybReturn }) {
  const kyb = useBuyerKyb();
  const openModal = useOpenModal();
  const status = kyb.snapshot?.verification?.status ?? 'Not started';
  return (
    <button
      type="button"
      className={`onx-account-verify buyer-kyb-button ${kyb.approved ? 'verified' : ''}`}
      data-act="buyer-kyb"
      onClick={() => openModal('buyer-kyb', { returnTo })}
    >
      <AccountIcons.shield />
      <span>KYB</span>
      <span className="onx-account-review-status">
        {kyb.query.isLoading && kyb.connected
          ? 'Checking…'
          : kyb.query.isError
            ? 'Status unavailable'
            : status}
      </span>
    </button>
  );
}

export function BuyerKybGate({
  children,
  returnTo,
  topupContext,
}: {
  children: ReactNode;
  returnTo?: BuyerKybReturn;
  topupContext?: TopupContext;
}) {
  const kyb = useBuyerKyb();
  const openModal = useOpenModal();
  if (kyb.approved) return <>{children}</>;
  const status = kyb.snapshot?.verification?.status;
  return (
    <div className="buyer-kyb buyer-kyb-gate" role="status">
      <span className="buyer-kyb-status">{status ?? 'KYB required'}</span>
      <h3>Verify your business to continue.</h3>
      <p>
        {status === 'Reviewing'
          ? 'Your KYB is being reviewed. We will notify you as soon as the review is complete.'
          : status === 'Rejected'
            ? 'Please check your private notifications and resubmit your KYB before making a payment.'
            : 'Complete business verification before adding credit or purchasing capacity. Bank transfers are available after approval.'}
      </p>
      {!kyb.demo && (!kyb.connected || kyb.query.isError) && (
        <p className="buyer-kyb-help">
          {kyb.query.isError
            ? 'Your KYB status could not be verified. Please retry before continuing.'
            : 'Secure Buyer KYB submission is not connected yet. No documents or payment will be submitted.'}
        </p>
      )}
      <button
        type="button"
        className="btn"
        onClick={() =>
          openModal('buyer-kyb', {
            returnTo,
            ...(returnTo === 'topup' && topupContext && kyb.identity
              ? { topupReturn: { identity: kyb.identity, context: topupContext } }
              : {}),
          })
        }
      >
        {status ? 'View KYB' : 'Complete KYB'}
      </button>
    </div>
  );
}
