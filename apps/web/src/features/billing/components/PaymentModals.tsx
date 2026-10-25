'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import { useApp } from '@/components/providers/app-context';
import { useTerminal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { refreshBillingAccount } from '../account';
import { billingApi } from '../api';
import { usd } from '../analytics';
import { METHODS, PRESETS, canReturn, hasPendingTopup, ownRequests, paymentIdentity, purchaseReference, requestFor, resumePurchase, safeCheckoutUrl, usePaymentStore, validAmount, validRequest } from '../payments';

const Btn = ({ act, primary = false, children, onClick, id, type = 'button' }: { act?: string; primary?: boolean; children: React.ReactNode; onClick?: () => void; id?: string; type?: 'button' | 'submit' }) => (
  <button type={type} className={`btn ${primary ? '' : 'secondary'}`} data-act={act} data-id={id} onClick={onClick}>
    {children}
  </button>
);

export function PaymentAmount({ orderId, purchaseReference: linkedRef, spotCheckout }: { orderId?: string; purchaseReference?: string; spotCheckout?: boolean }) {
  const { openModal, closeModal } = useTerminal();
  const toast = useToast();
  const { demo } = useApp();
  const draft = usePaymentStore((s) => s.draft);
  const setDraft = usePaymentStore((s) => s.setDraft);
  const amount = Number(draft?.amount) || 100;
  const other = !PRESETS.includes(amount);
  const [preset, setPreset] = useState(other ? 'other' : String(amount));
  const [custom, setCustom] = useState(other ? String(amount) : '');
  const linked = spotCheckout ? purchaseReference() : typeof linkedRef === 'string' && linkedRef === purchaseReference() ? linkedRef : '';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(preset === 'other' ? custom : preset);
    if (!validAmount(value)) return toast('Enter an amount from $1.00 to $100,000.00 with no more than two decimal places.');
    setDraft({ amount: Math.round(value * 100) / 100, orderId: orderId || null, purchaseReference: linked && linked === purchaseReference() ? linked : '', owner: paymentIdentity(undefined, demo), idempotencyKey: crypto.randomUUID() });
    openModal('payment-method');
  };
  return (
    <form data-form="payment-amount" data-order-id={orderId || ''} data-purchase-reference={linked} onSubmit={submit}>
      <p className="form-note">Choose a top-up amount. Credit is added after operations verifies your payment.</p>
      <div className="pay-presets">
        {PRESETS.map((value) => (
          <label key={value}>
            <input type="radio" name="preset" value={String(value)} checked={preset === String(value)} onChange={() => setPreset(String(value))} />
            <span>{usd(value)}</span>
          </label>
        ))}
        <label>
          <input type="radio" name="preset" value="other" checked={preset === 'other'} onChange={() => setPreset('other')} />
          <span>Other</span>
        </label>
      </div>
      <label className="form-label">
        Other amount · USD
        <input className="field" type="number" name="custom" min={1} max={100000} step="0.01" value={custom} placeholder="Enter amount" onChange={(e) => { setCustom(e.target.value); setPreset('other'); }} />
      </label>
      <div className="modal-footer">
        <Btn act="close-modal" onClick={closeModal}>Cancel</Btn>
        <Btn type="submit" primary>Process</Btn>
      </div>
    </form>
  );
}

export function PaymentMethod() {
  const { openModal } = useTerminal();
  const api = useApi();
  const toast = useToast();
  const { demo } = useApp();
  const draft = usePaymentStore((s) => s.draft);
  const update = usePaymentStore((s) => s.update);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  if (!draft) return <p>Start a new credit top-up.</p>;
  const back = () => {
    if (draft.submitted) return toast('This request may already be recorded. Retry the same details or check your notifications.');
    openModal('pay-start', { purchaseReference: draft.purchaseReference || '', orderId: draft.orderId || undefined });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const method = String(new FormData(event.currentTarget).get('method') || '');
    const owner = paymentIdentity(undefined, demo);
    const current = usePaymentStore.getState().draft;
    if (!current || !owner || current.owner !== owner || !METHODS.some(([m]) => m === method)) return toast('Choose an amount and payment method in your signed-in account.');
    if (current.busy) return;
    if (current.submitted && current.method !== method) return toast('This request may already be recorded. Retry the same payment method or check your notifications.');
    update({ busy: true, method });
    setBusy(true);
    setError('');
    const stillCurrent = () => paymentIdentity(undefined, demo) === owner && usePaymentStore.getState().draft?.idempotencyKey === current.idempotencyKey && mounted.current;
    try {
      update({ submitted: true });
      const result = await billingApi.createTopup(api, { amount: current.amount, method: method as 'credit_card' | 'paypal', idempotencyKey: current.idempotencyKey, ...(current.purchaseReference ? { purchaseReference: current.purchaseReference } : {}) });
      if (!stillCurrent()) return;
      const checked = { ...current, method };
      if (!validRequest(result.request, checked)) throw new Error('The top-up request was not confirmed. Check your notifications before trying again.');
      const request = result.request;
      const S = useWorkspaceStore.getState();
      S.patch({ topupRequests: [request, ...ownRequests().filter((row) => row.id !== request.id)] });
      update({ requestId: request.id });
      openModal('payment-topup-status', { id: request.id });
      refreshBillingAccount().catch(() => {});
    } catch (failure) {
      if (stillCurrent()) setError((failure as Error).message);
    } finally {
      update({ busy: false });
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <div className="pay-summary"><span>Credit top-up</span><strong>{usd(draft.amount)}</strong></div>
      <form data-form="payment-method" onSubmit={submit}>
        <div className="payment-methods">
          {METHODS.map(([value, label], index) => (
            <label key={value} className="payment-method">
              <input type="radio" name="method" value={value} defaultChecked={draft.method ? draft.method === value : index === 0} required />
              <span><strong>{label}</strong></span>
            </label>
          ))}
        </div>
        <p className="form-note">Submit your top-up request for payment verification. Credit is added only after operations approves the received funds. Promotional credit cannot be withdrawn.</p>
        <div className="payment-error form-note" role="alert" hidden={!error}>{error}</div>
        <div className="modal-footer">
          <Btn act="payment-amount-back" onClick={back}>Back</Btn>
          <button className="btn" type="submit" disabled={busy}>Proceed to payment</button>
        </div>
      </form>
    </>
  );
}

export function TopupStatus({ id }: { id?: string }) {
  const { closeModal } = useTerminal();
  const toast = useToast();
  const topups = useWorkspaceStore((s) => s.topupRequests);
  void topups;
  const request = requestFor(id);
  const [error, setError] = useState('');
  const refresh = () => refreshBillingAccount().catch((e: Error) => { setError(e.message); toast(e.message); });
  const returnToPurchase = async () => {
    const reference = purchaseReference();
    if (!canReturn(request)) return toast('This top-up is not linked to an approved purchase return.');
    try {
      const account = await refreshBillingAccount();
      if (!account || purchaseReference() !== reference) return;
      if (!canReturn(requestFor(id))) throw new Error('This top-up has not been confirmed for the current purchase.');
      resumePurchase();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (!request)
    return (
      <>
        <p className="form-note">This top-up request is unavailable. Refresh your account or check your notifications.</p>
        <div className="modal-footer">
          <Btn act="payment-refresh-status" onClick={refresh}>Refresh</Btn>
          <Btn act="close-modal" primary onClick={closeModal}>Close</Btn>
        </div>
      </>
    );
  const approved = request.status === 'Approved';
  const rejected = request.status === 'Rejected';
  const message = approved ? usd(request.amount) + ' has been credited to your account.' : rejected ? 'Your ' + usd(request.amount) + ' top-up was not approved. No credit was added.' : 'Your ' + usd(request.amount) + ' top-up request has been received and is awaiting payment verification. We will notify you when the review is complete.';
  return (
    <>
      <div className="pay-summary"><span>Credit top-up</span><strong>{usd(request.amount)}</strong></div>
      <p className="form-note" role="status">{message}</p>
      {rejected && request.reason ? <p className="form-note">{request.reason}</p> : null}
      <div className="payment-error form-note" role="alert" hidden={!error}>{error}</div>
      <div className="modal-footer">
        {canReturn(request) ? <Btn act="payment-return-purchase" id={request.id} onClick={returnToPurchase}>Back to purchase</Btn> : null}
        <Btn act="close-modal" primary onClick={closeModal}>Done</Btn>
      </div>
    </>
  );
}
TopupStatus.Title = function TopupStatusTitle({ id }: { id?: string }) {
  useWorkspaceStore((s) => s.topupRequests);
  const request = requestFor(id);
  return <>{!request ? 'Top-up status' : request.status === 'Approved' ? 'Credit added.' : request.status === 'Rejected' ? 'Top-up not approved.' : 'Top-up in progress.'}</>;
};

export function PaymentProvider() {
  const { openModal } = useTerminal();
  const draft = usePaymentStore((s) => s.draft);
  let url = '';
  try {
    url = safeCheckoutUrl((draft as { checkoutUrl?: unknown } | null)?.checkoutUrl);
  } catch {
    return <p className="form-note">A secure payment link is not available. No credit has been added.</p>;
  }
  return (
    <>
      <div className="pay-summary"><span>Credit top-up</span><strong>{usd(draft?.amount)}</strong></div>
      <p className="form-note">Continue in the payment provider&apos;s secure checkout. Your balance changes only after confirmed payment.</p>
      <div className="modal-footer">
        <Btn act="payment-method-back" onClick={() => openModal('payment-method')}>Back</Btn>
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open secure checkout</a>
      </div>
    </>
  );
}

/** Polls the credit account every 10 s while a top-up is pending, and on focus / visibility. */
export function useTopupPolling() {
  const { demo } = useApp();
  const topups = useWorkspaceStore((s) => s.topupRequests);
  const modalType = useWorkspaceStore((s) => s.modal?.type);
  useEffect(() => {
    const quiet = () => {
      if (!paymentIdentity(undefined, demo) || document.hidden || (!hasPendingTopup() && modalType !== 'payment-topup-status')) return;
      refreshBillingAccount().catch(() => {});
    };
    window.addEventListener('focus', quiet);
    document.addEventListener('visibilitychange', quiet);
    const timer = hasPendingTopup() ? setInterval(quiet, 10000) : null;
    return () => {
      window.removeEventListener('focus', quiet);
      document.removeEventListener('visibilitychange', quiet);
      if (timer) clearInterval(timer);
    };
  }, [demo, topups, modalType]);
}
