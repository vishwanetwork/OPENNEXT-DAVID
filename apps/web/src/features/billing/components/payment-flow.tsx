'use client';

import { useState, type FormEvent } from 'react';
import { useStartBankTransfer } from '@/features/bank-transfer';
import { useToast } from '@/components/ui/toast';
import { useTerminal } from '@/terminal-kit';
import { usd } from '../analytics';
import { useOwnTopups, usePaymentIdentity } from '../hooks';
import { METHODS, PRESETS, usePaymentStore, validAmount } from '../payments';
import { Btn } from './payment-ui';

export function PaymentAmount({
  orderId,
  purchaseReference: linkedRef,
  spotCheckout,
}: {
  orderId?: string;
  purchaseReference?: string;
  spotCheckout?: boolean;
}) {
  const { openModal, closeModal } = useTerminal();
  const toast = useToast();
  const owner = usePaymentIdentity();
  const { purchaseReference } = useOwnTopups();
  const draft = usePaymentStore((s) => s.draft);
  const setDraft = usePaymentStore((s) => s.setDraft);
  const amount = Number(draft?.amount) || 100;
  const other = !PRESETS.includes(amount);
  const [preset, setPreset] = useState(other ? 'other' : String(amount));
  const [custom, setCustom] = useState(other ? String(amount) : '');
  const linked = spotCheckout
    ? purchaseReference()
    : typeof linkedRef === 'string' && linkedRef === purchaseReference()
      ? linkedRef
      : '';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(preset === 'other' ? custom : preset);
    if (!validAmount(value))
      return toast(
        'Enter an amount from $1.00 to $100,000.00 with no more than two decimal places.',
      );
    setDraft({
      amount: Math.round(value * 100) / 100,
      orderId: orderId || null,
      purchaseReference: linked && linked === purchaseReference() ? linked : '',
      owner,
      idempotencyKey: crypto.randomUUID(),
    });
    openModal('payment-method');
  };
  return (
    <form
      data-form="payment-amount"
      data-order-id={orderId || ''}
      data-purchase-reference={linked}
      onSubmit={submit}
    >
      <p className="form-note">
        Choose a top-up amount. Credit is added after operations verifies your payment.
      </p>
      <div className="pay-presets">
        {PRESETS.map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="preset"
              value={String(value)}
              checked={preset === String(value)}
              onChange={() => setPreset(String(value))}
            />
            <span>{usd(value)}</span>
          </label>
        ))}
        <label>
          <input
            type="radio"
            name="preset"
            value="other"
            checked={preset === 'other'}
            onChange={() => setPreset('other')}
          />
          <span>Other</span>
        </label>
      </div>
      <label className="form-label">
        Other amount · USD
        <input
          className="field"
          type="number"
          name="custom"
          min={1}
          max={100000}
          step="0.01"
          value={custom}
          placeholder="Enter amount"
          onChange={(e) => {
            setCustom(e.target.value);
            setPreset('other');
          }}
        />
      </label>
      <div className="modal-footer">
        <Btn act="close-modal" onClick={closeModal}>
          Cancel
        </Btn>
        <Btn type="submit" primary>
          Process
        </Btn>
      </div>
    </form>
  );
}

export function PaymentMethod() {
  const { openModal } = useTerminal();
  const owner = usePaymentIdentity();
  const draft = usePaymentStore((state) => state.draft);
  const transfer = useStartBankTransfer();
  if (!draft || draft.owner !== owner) return <p>Start a new credit top-up.</p>;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = usePaymentStore.getState().draft;
    if (!current || current.owner !== owner || !validAmount(current.amount)) return;
    await transfer.start({
      purpose: 'topup',
      amountCents: Math.round(current.amount * 100),
      currency: 'USD',
      idempotencyKey: current.idempotencyKey,
      ...(current.orderId ? { orderId: current.orderId } : {}),
      ...(current.purchaseReference ? { purchaseReference: current.purchaseReference } : {}),
    });
  };
  return (
    <>
      <div className="pay-summary">
        <span>Credit top-up</span>
        <strong>{usd(draft.amount)}</strong>
      </div>
      <form data-form="payment-method" onSubmit={submit}>
        <div className="payment-methods">
          {METHODS.map(([value, label]) => (
            <label key={value} className="payment-method">
              <input type="radio" name="method" value={value} checked readOnly />
              <span>
                <strong>{label}</strong>
                <small>USD · subject to KYB approval</small>
              </span>
            </label>
          ))}
        </div>
        <p className="form-note">
          Credit is added only after operations confirms receipt of your bank transfer. Card and
          online payment providers are not available yet.
        </p>
        {!transfer.connected && (
          <p className="form-note" role="status">
            Bank transfer instructions are not connected yet. No payment request will be submitted.
          </p>
        )}
        {transfer.error && (
          <p className="payment-error form-note" role="alert">
            {transfer.error}
          </p>
        )}
        <div className="modal-footer">
          <Btn
            act="payment-amount-back"
            onClick={() =>
              openModal('pay-start', {
                purchaseReference: draft.purchaseReference || '',
                orderId: draft.orderId || undefined,
              })
            }
          >
            Back
          </Btn>
          <button className="btn" type="submit" disabled={transfer.busy || !transfer.connected}>
            {transfer.busy ? 'Checking…' : 'Proceed to payment'}
          </button>
        </div>
      </form>
    </>
  );
}
