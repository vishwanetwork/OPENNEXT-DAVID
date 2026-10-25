'use client';

import { type FormEvent } from 'react';
import { ModalFrame, type ModalComponent, type ModalComponents } from '@/terminal-kit';
import { usd, type SpotRow } from '../inventory';
import { CHECKOUT_MODALS, totalsView, type CheckoutDraft } from '../checkout';
import { useSpotCheckout } from '../hooks';

function Totals({ row, hours }: { row: SpotRow; hours: unknown }) {
  const { total, hourly } = totalsView(row, hours);
  return (
    <>
      <p>
        <span>/ hour</span>
        <strong>{hourly}</strong>
      </p>
      <p>
        <span>
          Compute / hour
          {total ? (
            <small>
              {total.durationHours} {total.durationHours === 1 ? 'hour' : 'hours'} ×{' '}
              {usd(total.hourlyCents / 100)} / hour
            </small>
          ) : null}
        </span>
        <strong data-spot-compute>{total ? usd(total.baseCents / 100) : '—'}</strong>
      </p>
      <p>
        <span>OpenNEXT Fee 5%</span>
        <strong data-spot-fee>{total ? usd(total.feeCents / 100) : '—'}</strong>
      </p>
      <p className="onx-spot-checkout-total">
        <span>Total</span>
        <strong data-spot-total>{total ? usd(total.totalCents / 100) : '—'}</strong>
      </p>
    </>
  );
}

function Summary({
  row,
  draft,
  editable = false,
  onHours,
}: {
  row: SpotRow;
  draft: CheckoutDraft;
  editable?: boolean;
  onHours?: (value: string) => void;
}) {
  return (
    <>
      <div className="onx-spot-purchase-resource">
        <h3>
          {row.model} · {row.country}
        </h3>
        <p>
          {row.gpuCount} GPUs ·{' '}
          {row.memory === null ? 'Memory to confirm' : row.memory + ' GB / GPU'} ·{' '}
          {row.vcpu === null ? 'vCPU to confirm' : row.vcpu + ' vCPU'}
        </p>
      </div>
      {editable ? (
        <label className="form-label onx-spot-duration">
          Usage duration <span className="muted">(hours)</span>
          <input
            className="field"
            type="number"
            name="durationHours"
            data-spot-hours
            min={0.01}
            step={0.01}
            inputMode="decimal"
            required
            value={draft.hoursRaw}
            placeholder="Enter hours"
            onChange={(event) => onHours?.(event.target.value)}
          />
        </label>
      ) : null}
      <div className="onx-spot-checkout-summary" data-spot-checkout-totals aria-live="polite">
        <Totals row={row} hours={draft.hoursRaw} />
      </div>
    </>
  );
}

const Notice = ({ draft }: { draft: CheckoutDraft }) =>
  draft.message ? (
    <p className="onx-spot-purchase-note" role="status">
      {draft.message}
    </p>
  ) : null;
const ErrorLine = ({ draft }: { draft: CheckoutDraft }) => (
  <p className="onx-spot-purchase-error" data-spot-checkout-error role="alert">
    {draft.error}
  </p>
);

function Unavailable() {
  return <p className="form-note">Choose an available Spot offer to start a purchase.</p>;
}

function ReviewBody() {
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

function PaymentChoiceBody() {
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

function CreditConfirmBody() {
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

function CompleteBody() {
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

function PendingTitle({ fallback }: { fallback: string }) {
  const checkout = useSpotCheckout();
  return <>{checkout.pending() ? fallback : 'Purchase unavailable'}</>;
}

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'spot-review': Record<string, never>;
    'spot-payment-choice': Record<string, never>;
    'spot-credit-confirm': Record<string, never>;
    'spot-complete': Record<string, never>;
  }
}

const ReviewModal: ModalComponent<'spot-review'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Review Spot purchase" />} close={close}>
    <ReviewBody />
  </ModalFrame>
);
const PaymentChoiceModal: ModalComponent<'spot-payment-choice'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Choose payment" />} close={close}>
    <PaymentChoiceBody />
  </ModalFrame>
);
const CreditConfirmModal: ModalComponent<'spot-credit-confirm'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Confirm Credit payment" />} close={close}>
    <CreditConfirmBody />
  </ModalFrame>
);
const CompleteModal: ModalComponent<'spot-complete'> = ({ close }) => (
  <ModalFrame title={<PendingTitle fallback="Purchase confirmed" />} close={close}>
    <CompleteBody />
  </ModalFrame>
);

/** Spot checkout dialogs, keyed by type for the composition root. */
export const spotCheckoutModals: ModalComponents = {
  'spot-review': ReviewModal,
  'spot-payment-choice': PaymentChoiceModal,
  'spot-credit-confirm': CreditConfirmModal,
  'spot-complete': CompleteModal,
};
