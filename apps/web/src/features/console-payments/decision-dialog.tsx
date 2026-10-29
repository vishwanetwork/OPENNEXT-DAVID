'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { describeError, isConflict, isUnauthorized } from '@/lib/api/errors';
import { money } from '@/lib/format';
import type {
  PaymentReviewDecision,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';
import { confirmedPaymentDecision, reviewable } from './validation';

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
  onConfirmed: () => void;
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
  const label = fail
    ? 'Fail payment request'
    : record.kind === 'topup'
      ? 'Add Credit'
      : 'Confirm Direct Pay';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !reviewable(record)) return;
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
      const result = await service.decide(input);
      if (!active.current) return;
      if (!confirmedPaymentDecision(result, record, input))
        throw new Error(
          'The decision, account update and notification/email queues were not fully confirmed. Refresh before retrying.',
        );
      onConfirmed();
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
          Confirmation asks the backend to queue provisioning. It does not mark an instance as
          running.
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
            I have independently verified receipt of the full bank payment.
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
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : fail ? 'Send' : record.kind === 'topup' ? 'Add Credit' : 'Confirm'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
