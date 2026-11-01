'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { AsyncButton } from '@/components/ui/async-feedback';
import { describeError, isConflict, isUnauthorized } from '@/lib/api/errors';
import type { CashoutAdminService, CashoutRecord } from '@/lib/cashout';
import { money, stampUtc } from '@/lib/format';
import { useCashoutDetails } from './hooks';
import { cashoutCompletionKey, verifiedCashoutCompletion } from './validation';

export function CashoutRequestDialog({
  record,
  service,
  completing,
  onClose,
  onCompleted,
  onAccessDenied,
  onRefresh,
}: {
  record: CashoutRecord;
  service: CashoutAdminService;
  completing: boolean;
  onClose: () => void;
  onCompleted: () => void;
  onAccessDenied: () => void;
  onRefresh: () => void;
}) {
  const details = useCashoutDetails(service, record);
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const lock = useRef(false);
  const attemptedReference = useRef<string | null>(null);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (isUnauthorized(details.error)) onAccessDenied();
    else if (isConflict(details.error)) onRefresh();
  }, [details.error, onAccessDenied, onRefresh]);
  const bank = details.error ? undefined : details.data;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !service.complete || record.status !== 'pending') return;
    if (!bank || details.isFetching) {
      setError('Load and verify this request’s bank details before completing the payout.');
      return;
    }
    if (!verified || !reference.trim()) {
      setError('Confirm the completed bank transfer and enter its reference.');
      return;
    }
    if (attemptedReference.current && attemptedReference.current !== reference.trim()) {
      setError('This completion may already be recorded. Refresh before changing the reference.');
      return;
    }
    attemptedReference.current = reference.trim();
    const input = {
      requestId: record.id,
      accountId: record.accountId,
      expectedRevision: record.revision,
      transferReference: reference.trim(),
      idempotencyKey: cashoutCompletionKey(record),
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await service.complete(input);
      if (!active.current) return;
      if (!verifiedCashoutCompletion(result, record, input))
        throw new Error(
          'The payout, Credit settlement and notification/email queues were not fully confirmed. Refresh before retrying.',
        );
      onCompleted();
    } catch (cause) {
      if (!active.current) return;
      if (isUnauthorized(cause)) onAccessDenied();
      else if (isConflict(cause)) onRefresh();
      else setError(describeError(cause).message);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <Dialog
      overlayClassName="cashout-review-overlay"
      className="cashout-review-dialog"
      label={completing ? 'Complete cashout' : 'Cashout request details'}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnEscape={!busy}
    >
      <h2>{completing ? 'Complete cashout' : 'Cashout request details'}</h2>
      <p>
        {record.companyName} · {money(record.amountCents / 100)} USD
      </p>
      <dl>
        <div>
          <dt>Account #</dt>
          <dd>{record.accountNumber}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{record.email}</dd>
        </div>
        <div>
          <dt>Registered company</dt>
          <dd>{record.companyName}</dd>
        </div>
        <div>
          <dt>Registration number</dt>
          <dd>{record.registrationNumber}</dd>
        </div>
        <div>
          <dt>Company country</dt>
          <dd>{record.companyCountry}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{stampUtc(record.submittedAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{record.status}</dd>
        </div>
        {record.transferReference && (
          <div>
            <dt>Transfer reference</dt>
            <dd>{record.transferReference}</dd>
          </div>
        )}
      </dl>
      <h3>Receiving bank details</h3>
      {!service.details && <p role="status">Private bank details are awaiting backend.</p>}
      {details.isLoading && <p role="status">Loading private bank details…</p>}
      {details.error && <p role="alert">{describeError(details.error).message}</p>}
      {bank && (
        <dl>
          {(
            [
              ['Beneficiary', bank.beneficiaryName],
              ['Beneficiary address', bank.beneficiaryAddress],
              ['Bank', bank.bankName],
              ['Bank country', bank.bankCountry],
              ['Bank address', bank.bankAddress],
              ['Account number', bank.accountNumber],
              ['IBAN', bank.iban],
              ['SWIFT / BIC', bank.swiftBic],
              ['Routing code', bank.routingCode],
              ['Intermediary bank', bank.intermediaryBank],
              ['Intermediary SWIFT / BIC', bank.intermediarySwiftBic],
            ] as const
          )
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      )}
      {completing ? (
        <form onSubmit={submit} noValidate>
          <label>
            Bank transfer reference
            <input
              value={reference}
              required
              maxLength={160}
              disabled={busy}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label className="cashout-review-check">
            <input
              type="checkbox"
              checked={verified}
              disabled={busy}
              onChange={(event) => setVerified(event.target.checked)}
            />
            I have independently verified that the full payout was sent to the approved company’s
            bank account.
          </label>
          <p className="cashout-review-note">
            Completed records the bank payout; it does not send money or confirm receipt by the
            recipient’s bank. The backend settles the reserved Credit and queues the customer
            notification and email.
          </p>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <AsyncButton
              type="submit"
              className="btn primary"
              busy={busy}
              disabled={busy || !bank || details.isFetching || !service.complete}
            >
              Completed
            </AsyncButton>
          </footer>
        </form>
      ) : (
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      )}
    </Dialog>
  );
}
