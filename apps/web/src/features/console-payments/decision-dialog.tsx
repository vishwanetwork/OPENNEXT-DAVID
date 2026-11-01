'use client';

import { AsyncButton } from '@/components/ui/async-feedback';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { describeError, isConflict, isUnauthorized } from '@/lib/api/errors';
import { money } from '@/lib/format';
import type {
  PaymentReviewDecision,
  PaymentReviewRecord,
  PaymentReviewReceipt,
  PaymentReviewService,
} from '@/lib/payment-review';
import { canComplete, confirmedPaymentDecision, reviewable } from './validation';

export function PaymentDecisionDialog({
  record,
  decision,
  service,
  onClose,
  onConfirmed,
  onAccessDenied,
  onRefresh,
}: {
  record: PaymentReviewRecord;
  decision: 'Confirm' | 'Fail';
  service: PaymentReviewService;
  onClose: () => void;
  onConfirmed: (receipt: PaymentReviewReceipt) => void;
  onAccessDenied: () => void;
  onRefresh: () => void;
}) {
  const [reason, setReason] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const lock = useRef(false);
  const submitted = useRef<{ signature: string; key: string } | null>(null);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const fail = decision === 'Fail';
  const subject = record.kind === 'topup' ? 'top-up' : 'payment';
  const label = fail ? `Failed ${subject}` : `Complete ${subject}`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !reviewable(record)) return;
    if (!fail && !canComplete(record, service)) {
      setError('Completion requires the availability recheck service. No decision was submitted.');
      return;
    }
    if (fail && !reason.trim()) {
      setError('Enter a reason before sending the failure notification.');
      return;
    }
    if (!fail && !verified) {
      setError('Confirm that the full bank payment has been independently verified.');
      return;
    }
    const signature = JSON.stringify([
      record.id,
      record.revision,
      decision,
      fail ? reason.trim() : '',
    ]);
    if (submitted.current && submitted.current.signature !== signature) {
      setError('A decision may already exist. Refresh this case before changing the decision.');
      return;
    }
    if (!submitted.current) submitted.current = { signature, key: crypto.randomUUID() };
    const input: PaymentReviewDecision = {
      caseId: record.id,
      accountId: record.accountId,
      expectedRevision: record.revision,
      idempotencyKey: submitted.current.key,
      decision,
      fundsVerified: !fail && verified,
      reason: fail ? reason.trim() : '',
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const complete = service.completeDirectPay;
      const result =
        !fail && record.kind === 'direct_pay' && complete
          ? await complete(input)
          : await service.decide(input);
      if (!active.current) return;
      if (!confirmedPaymentDecision(result, record, input))
        throw new Error(
          'The decision, account update and notification/email queues were not fully confirmed. Refresh before retrying.',
        );
      onConfirmed(result);
    } catch (cause) {
      if (!active.current) return;
      if (isUnauthorized(cause)) onAccessDenied();
      else {
        setError(describeError(cause).message);
        if (isConflict(cause)) onRefresh();
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <Dialog
      overlayClassName="payment-review-overlay"
      className="payment-review-dialog"
      label={label}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnEscape={!busy}
    >
      <h2>{label}</h2>
      <p>
        {record.email} · {money(record.amountCents / 100)}
      </p>
      {!fail && record.kind === 'topup' && (
        <p>
          Credit to add: {money((record.creditAmountCents ?? 0) / 100)}. The full received amount is
          credited with no top-up fee.
        </p>
      )}
      {!fail && record.kind === 'direct_pay' && (
        <p>
          Provider eligibility for the original resource will be checked again. If preflight passes,
          the customer can continue their paid purchase in Instances. Spot stock is confirmed only
          when allocation succeeds. If the check or allocation fails, the full payment becomes
          Credit. This action does not provision an instance.
        </p>
      )}
      <form onSubmit={submit} noValidate>
        {fail ? (
          <label>
            Failure reason
            <textarea
              required
              rows={4}
              maxLength={2000}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : (
          <label className="payment-review-check">
            <input
              type="checkbox"
              checked={verified}
              disabled={busy}
              onChange={(event) => setVerified(event.target.checked)}
            />
            I have independently verified receipt of the full bank payment and its reference.
          </label>
        )}
        <p className="payment-review-note">
          The account owner will receive a notification and email only after the backend confirms
          this decision.
        </p>
        {error && (
          <p role="alert" className="payment-review-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <AsyncButton busy={busy} type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : fail ? 'Submit' : 'Completed'}
          </AsyncButton>
        </footer>
      </form>
    </Dialog>
  );
}
