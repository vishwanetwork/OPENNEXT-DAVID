'use client';

import { type FormEvent } from 'react';
import { usd } from '../inventory';
import { useSpotCheckout } from '../hooks';
import { ErrorLine, Notice, Summary, Unavailable } from './checkout-summary';

export function ReviewBody() {
  const checkout = useSpotCheckout();
  const draft = checkout.pending();
  if (!draft) return <Unavailable />;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void checkout.reviewPurchase({
      durationHours: data.get('durationHours'),
      sshPublicKey: data.get('sshPublicKey'),
    });
  };
  return (
    <form
      data-form="spot-checkout-review"
      className="onx-spot-purchase"
      noValidate
      onSubmit={submit}
    >
      <Summary
        row={draft.row}
        draft={draft}
        editable
        onHours={(value) => checkout.setHoursRaw(value)}
      />
      <Notice draft={draft} />
      <label className="form-label">
        SSH Public Key <span className="muted">(optional)</span>
        <textarea
          className="field"
          name="sshPublicKey"
          data-spot-ssh
          rows={4}
          maxLength={16384}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste your SSH public key"
          value={draft.sshRaw || ''}
          onChange={(event) => checkout.setSshRaw(event.target.value)}
        />
      </label>
      <p className="form-note">
        Add your SSH public key now to access your instance as soon as it is ready, or set it up
        later in Instances.
      </p>
      <ErrorLine draft={draft} />
      <div className="modal-footer">
        <button
          type="button"
          className="btn secondary"
          data-act="spot-checkout-cancel"
          onClick={() => checkout.action('spot-checkout-cancel')}
        >
          Cancel
        </button>
        <button type="submit" className="btn" disabled={draft.busy}>
          Proceed to payment
        </button>
      </div>
    </form>
  );
}

export function PaymentChoiceBody() {
  const checkout = useSpotCheckout();
  const draft = checkout.pending();
  if (!draft) return <Unavailable />;
  const credit = checkout.availableCredit();
  return (
    <div className="onx-spot-purchase">
      <Summary row={draft.row} draft={draft} />
      <Notice draft={draft} />
      <div className="onx-spot-payment-options">
        <button
          type="button"
          data-act="spot-checkout-credit"
          disabled={draft.busy}
          onClick={() => checkout.action('spot-checkout-credit')}
        >
          <span>
            <strong>Pay by Credit</strong>
            <small
              className={`onx-spot-credit-available${checkout.insufficientCredit(draft) ? ' is-insufficient' : ''}`}
            >
              Available Credit: {credit === null ? '—' : usd(credit)}
            </small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
        <button
          type="button"
          data-act="spot-checkout-direct"
          onClick={() => checkout.action('spot-checkout-direct')}
        >
          <span>
            <strong>Direct Pay</strong>
            <small>Pay with a payment provider</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <ErrorLine draft={draft} />
      <div className="modal-footer">
        <button
          type="button"
          className="btn secondary"
          data-act="spot-checkout-review"
          onClick={() => checkout.action('spot-checkout-review')}
        >
          Back to review
        </button>
      </div>
    </div>
  );
}

export function CreditConfirmBody() {
  const checkout = useSpotCheckout();
  const draft = checkout.pending();
  if (!draft) return <Unavailable />;
  const credit = checkout.availableCredit();
  const short = checkout.insufficientCredit(draft);
  return (
    <div className="onx-spot-purchase">
      <Summary row={draft.row} draft={draft} />
      <div className={`onx-spot-credit-balance${short ? ' is-insufficient' : ''}`}>
        <span>Available Credit</span>
        <strong>{credit === null ? '—' : usd(credit)}</strong>
      </div>
      {short ? (
        <p className="onx-spot-credit-shortfall">
          Insufficient Credit. Add credit to complete this purchase.
        </p>
      ) : null}
      <Notice draft={draft} />
      <ErrorLine draft={draft} />
      <div className="modal-footer">
        <button
          type="button"
          className="btn secondary"
          data-act="spot-checkout-payment"
          onClick={() => checkout.action('spot-checkout-payment')}
        >
          Back
        </button>
        <button
          type="button"
          className="btn"
          data-act={short ? 'spot-checkout-deposit' : 'spot-checkout-authorize'}
          disabled={draft.busy}
          onClick={() =>
            checkout.action(short ? 'spot-checkout-deposit' : 'spot-checkout-authorize')
          }
        >
          {short ? 'Deposit Credit' : 'Confirm Credit payment'}
        </button>
      </div>
    </div>
  );
}

export function CompleteBody() {
  const checkout = useSpotCheckout();
  const draft = checkout.pending();
  if (!draft) return <Unavailable />;
  return (
    <div className="onx-spot-purchase">
      <p>Your order was confirmed by OpenNEXT.</p>
      <p className="form-note">
        Order {draft.orderId || ''}. Provisioning updates will appear in Instances.
      </p>
      <div className="modal-footer">
        <button
          type="button"
          className="btn"
          data-act="spot-checkout-instances"
          onClick={() => checkout.action('spot-checkout-instances')}
        >
          View Instances
        </button>
      </div>
    </div>
  );
}

export function PendingTitle({ fallback }: { fallback: string }) {
  const checkout = useSpotCheckout();
  return <>{checkout.pending() ? fallback : 'Purchase unavailable'}</>;
}
