'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FloatingSpotAcceptance, FloatingSpotQuote } from '@opennext/contracts';
import type { z } from 'zod';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { useOpenVerifiedBankTransfer } from '@/features/bank-transfer';
import { describeError } from '@/lib/api/errors';
import { ApiError } from '@/lib/api/client';
import { money, stampUtc } from '@/lib/format';
import { useSessionStore } from '@/lib/session-store';
import { useAccountIdentity, useInvalidateWorkspace, useIsDemo } from '@/terminal-kit';
import { liveSpotFundingApi } from '../live-api';
import { dollarCents } from '../amounts';

type Acceptance = z.infer<typeof FloatingSpotAcceptance>;
type Quote = z.infer<typeof FloatingSpotQuote>;
export interface FloatingCheckoutProps {
  offerId: string;
  durationHours: number;
  hourlyCents: number;
  sshPublicKey: string | null;
  inferencePresetId?: string;
  inferenceBillingAcknowledged: boolean;
  idempotencyKey: string;
  acceptance?: Acceptance;
  onSubmission: (body: Acceptance) => void;
  onComplete: (orderId: string, directPay: boolean) => void;
  onRejected?: () => void;
  onBack: () => void;
}

export function FloatingCheckout(props: FloatingCheckoutProps) {
  const identity = useAccountIdentity();
  return <FloatingCheckoutForm key={`${identity}:${props.idempotencyKey}`} {...props} />;
}

function FloatingCheckoutForm(props: FloatingCheckoutProps) {
  const api = useApi();
  const demo = useIsDemo();
  const userId = useSessionStore((s) => s.user?.id);
  const client = useQueryClient();
  const invalidate = useInvalidateWorkspace();
  const openTransfer = useOpenVerifiedBankTransfer();
  const [method, setMethod] = useState<'Credit' | 'Direct Pay'>('Credit');
  const [hourly, setHourly] = useState((Math.ceil(props.hourlyCents * 1.5) / 100).toFixed(2));
  const [total, setTotal] = useState(
    (Math.ceil(props.hourlyCents * props.durationHours * 2 + 1000) / 100).toFixed(2),
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [consent, setConsent] = useState(false);
  const [storage, setStorage] = useState(false);
  const [pending, setPending] = useState<Acceptance | undefined>(props.acceptance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const active = () => {
    const current = useSessionStore.getState();
    return (
      !demo &&
      current.status === 'verified' &&
      current.user?.id === userId &&
      current.user?.role === 'buyer' &&
      !current.user?.demo
    );
  };
  const change = () => {
    setQuote(null);
    setConsent(false);
    setStorage(false);
    setError('');
  };
  const loadQuote = async () => {
    if (lock.current || !active()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await liveSpotFundingApi.quote(api, {
        offerId: props.offerId,
        durationHours: props.durationHours,
        paymentMethod: method,
        maxHourlyCents: dollarCents(hourly),
        maxTotalCents: dollarCents(total),
        inferencePresetId: props.inferencePresetId ?? null,
      });
      if (!active()) return;
      if (
        result.accountId !== userId ||
        result.offerId !== props.offerId ||
        result.paymentMethod !== method
      )
        throw new Error('The quote could not be matched to this purchase.');
      setQuote(result);
    } catch (cause) {
      if (active()) setError(describeError(cause).message);
    } finally {
      lock.current = false;
      if (active()) setBusy(false);
    }
  };
  const submit = async () => {
    if (lock.current || !active()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (!pending && (!quote || !consent || !storage || Date.parse(quote.expiresAt) <= Date.now()))
        throw new Error('Review a current quote and accept its funding and storage conditions.');
      const body =
        pending ??
        FloatingSpotAcceptance.parse({
          pricingVersion: 'spot-hourly-v1',
          quoteId: quote?.quoteId,
          idempotencyKey: props.idempotencyKey,
          consent: true,
          storageRetentionAcknowledged: true,
          inferenceBillingAcknowledged: props.inferenceBillingAcknowledged,
          sshPublicKey: props.sshPublicKey,
        });
      // Retain this exact authorization before dispatch; uncertain replies are retried
      // with the same quote and idempotency key, including after a page reload.
      props.onSubmission(body);
      setPending(body);
      const result = await liveSpotFundingApi.purchase(api, body);
      if (!active()) return;
      if (result.accountId !== userId)
        throw new Error('The purchase account could not be verified.');
      if (result.transfer) openTransfer(result.transfer);
      props.onComplete(result.order.orderId, Boolean(result.transfer));
      void invalidate();
      void client.invalidateQueries({ queryKey: ['account'] });
    } catch (cause) {
      if (active()) {
        setError(describeError(cause).message);
        if (
          cause instanceof ApiError &&
          ['QUOTE_EXPIRED', 'INSUFFICIENT_CREDIT'].includes(cause.code ?? '')
        ) {
          setPending(undefined);
          setQuote(null);
          setConsent(false);
          setStorage(false);
          props.onRejected?.();
        }
      }
    } finally {
      lock.current = false;
      if (active()) setBusy(false);
    }
  };
  return (
    <div className="onx-spot-purchase" aria-busy={busy}>
      <h3>Floating Spot funding</h3>
      {pending ? (
        <p role="status">
          Payment confirmation is pending. Retry the same authorization to check its result. Check
          Billing and Instances before starting another order.
        </p>
      ) : (
        <>
          <fieldset disabled={busy}>
            <legend>Confirm your spending limits</legend>
            <label className="form-label">
              Payment method
              <select
                className="field"
                value={method}
                onChange={(e) => {
                  change();
                  setMethod(e.target.value === 'Credit' ? 'Credit' : 'Direct Pay');
                }}
              >
                <option>Credit</option>
                <option>Direct Pay</option>
              </select>
            </label>
            <label className="form-label">
              Maximum whole-instance hourly price (USD)
              <input
                className="field"
                inputMode="decimal"
                value={hourly}
                onChange={(e) => {
                  change();
                  setHourly(e.target.value);
                }}
              />
            </label>
            <label className="form-label">
              Maximum total funding, including storage (USD)
              <input
                className="field"
                inputMode="decimal"
                value={total}
                onChange={(e) => {
                  change();
                  setTotal(e.target.value);
                }}
              />
            </label>
            <p className="form-note">
              The Agent pauses if the next usage period cannot be funded or a limit is reached.
              Credit may be allocated automatically within these limits. Direct Pay requires
              confirmed order-linked transfers.
            </p>
            <AsyncButton
              busy={busy}
              type="button"
              className="btn secondary"
              onClick={() => void loadQuote()}
            >
              Review current quote
            </AsyncButton>
          </fieldset>
          {quote ? (
            <section aria-label="Confirmed floating Spot quote">
              <dl>
                <dt>Current whole-instance price / hour</dt>
                <dd>{money(quote.hourlyCents / 100)}</dd>
                <dt>Initial compute funding</dt>
                <dd>{money(quote.computeFundingCents / 100)}</dd>
                <dt>Seven-day storage reserve · {quote.protectedGiB} GiB</dt>
                <dd>{money(quote.storageReserveCents / 100)}</dd>
                <dt>Initial payment</dt>
                <dd>{money(quote.initialPaymentCents / 100)}</dd>
              </dl>
              <p className="form-note">
                Quote expires {stampUtc(quote.expiresAt)}. No fixed service fee. Storage tariff: $
                {quote.storageMonthlyUsd} per GiB-month. Unused compute funding is released at END;
                unused storage reserve is released after cleanup.
              </p>
              <label className="form-label">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I accept changing hourly prices, the displayed limits, billing from GPU delivery
                (including idle and model preparation), a one-hour minimum once per order and
                started-minute rounding.
              </label>
              <label className="form-label">
                <input
                  type="checkbox"
                  checked={storage}
                  disabled={busy}
                  onChange={(e) => setStorage(e.target.checked)}
                />
                I authorize the storage reserve. After a funding pause or END, retained data is kept
                for seven days and then deleted. I will check the confirmed backup status and
                retention deadline in Instances.
              </label>
            </section>
          ) : null}
        </>
      )}
      {error ? (
        <p className="form-note" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? <AsyncFeedback>Confirming the quote or payment. Please wait…</AsyncFeedback> : null}
      <div className="modal-footer">
        {!pending ? (
          <button type="button" className="btn secondary" disabled={busy} onClick={props.onBack}>
            Back to review
          </button>
        ) : null}
        <AsyncButton
          type="button"
          className="btn"
          busy={busy}
          disabled={busy || (!pending && (!quote || !consent || !storage))}
          onClick={() => void submit()}
        >
          {pending
            ? 'Retry confirmation'
            : method === 'Credit'
              ? 'Confirm Credit payment'
              : 'Create bank transfer instructions'}
        </AsyncButton>
      </div>
    </div>
  );
}
