'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AsyncButton } from '@/components/ui/async-feedback';
import type { BuyerKybCase } from '@/lib/buyer-kyb';
import type { CashoutBankDetails, CashoutSubmission } from '@/lib/cashout';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import { money } from '@/lib/format';
import { cashoutApi } from '../api';
import { useCashout } from '../hooks';
import { cashoutBindingError, createCashoutSubmission } from '../validation';
import { CashoutBankFields } from './bank-fields';

export function CashoutForm({ kyb, close }: { kyb: BuyerKybCase; close: () => void }) {
  const cashout = useCashout();
  const client = useQueryClient();
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState<CashoutBankDetails>({
    beneficiaryName: kyb.company.companyName,
    beneficiaryAddress: kyb.company.legalAddress,
    bankName: '',
    bankCountry: '',
    bankAddress: '',
    accountNumber: '',
    iban: '',
    swiftBic: '',
    routingCode: '',
    intermediaryBank: '',
    intermediarySwiftBic: '',
  });
  const [confirmedDetails, setConfirmedDetails] = useState(false);
  const [retryInput, setRetryInput] = useState<CashoutSubmission | null>(null);
  const [validationError, setValidationError] = useState('');
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const stillCurrent = () => {
    const session = useSessionStore.getState();
    return (
      active.current &&
      session.status === 'verified' &&
      session.user?.id === kyb.accountId &&
      session.user.role === 'buyer' &&
      !session.user.demo
    );
  };
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async (input: CashoutSubmission) => {
      if (!cashout.service || !stillCurrent()) throw new Error('Your account session has changed.');
      const result = await cashoutApi.submit(cashout.service, input);
      if (!stillCurrent()) throw new Error('Your account session has changed.');
      return result;
    },
    onSuccess: () => {
      if (!stillCurrent()) return;
      void client.invalidateQueries({ queryKey: queryKeys.account.cashout(cashout.identity) });
      void client.invalidateQueries({ queryKey: queryKeys.account.billing(cashout.identity) });
    },
  });
  const bindingError = cashout.snapshot ? cashoutBindingError(cashout.snapshot, kyb) : '';
  const unavailable = !cashout.connected
    ? 'Cashout processing is not connected yet. No request or bank details can be submitted.'
    : cashout.query.isError
      ? 'Your withdrawable Credit could not be verified. Refresh before continuing.'
      : !cashout.snapshot
        ? 'Loading verified withdrawable Credit…'
        : bindingError;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || unavailable || !confirmedDetails || !cashout.snapshot) return;
    submitting.current = true;
    setValidationError('');
    try {
      const input = retryInput ?? createCashoutSubmission(amount, bank, cashout.snapshot, kyb);
      setRetryInput(input);
      await mutation.mutateAsync(input);
    } catch (error) {
      if (stillCurrent())
        setValidationError(
          error instanceof Error ? error.message : 'Cashout could not be submitted.',
        );
    } finally {
      submitting.current = false;
    }
  };
  if (mutation.isSuccess)
    return (
      <div className="cashout-result" role="status">
        <h3>Cashout request submitted</h3>
        <p>
          {money(mutation.data.request.amountCents / 100)} is reserved for this cashout and cannot
          be used for purchases while it is pending.
        </p>
        <p>
          Our team will review the verified bank details and process the payout. Your Terminal
          notification and email will confirm when it is completed.
        </p>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={close}>
            Done
          </button>
        </div>
      </div>
    );
  return (
    <form className="cashout-form" onSubmit={(event) => void submit(event)} autoComplete="off">
      <div className="cashout-summary">
        <span>Available to cash out</span>
        <strong>
          {cashout.snapshot && !bindingError
            ? money(cashout.snapshot.withdrawableCents / 100)
            : '—'}
        </strong>
      </div>
      <p className="form-note">
        Only eligible paid Credit can be cashed out. Promotional Credit, unsettled funds and amounts
        reserved for purchases or pending cashouts are excluded.
      </p>
      {unavailable && (
        <p className="form-note" role="status">
          {unavailable}
        </p>
      )}
      <fieldset disabled={Boolean(unavailable) || mutation.isPending || Boolean(retryInput)}>
        <label className="cashout-amount">
          Cashout amount (USD)
          <input
            className="field"
            type="number"
            name="amount"
            min="0.01"
            step="0.01"
            max={cashout.snapshot ? cashout.snapshot.withdrawableCents / 100 : undefined}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <p className="form-note">
          The receiving account must belong to the same legal business as your approved KYB.
          Third-party accounts are not accepted.
        </p>
        <CashoutBankFields
          value={bank}
          change={setBank}
          lockedAddress={Boolean(kyb.company.legalAddress)}
        />
        <label className="cashout-consent">
          <input
            type="checkbox"
            checked={confirmedDetails}
            onChange={(event) => setConfirmedDetails(event.target.checked)}
          />
          <span>
            I confirm this bank account belongs to the verified business and that the receiving
            details are accurate.
          </span>
        </label>
      </fieldset>
      {validationError && (
        <p className="payment-error form-note" role="alert">
          {validationError}
        </p>
      )}
      {retryInput && !mutation.isSuccess && (
        <p className="form-note">
          This request keeps the same submission reference on retry. Check cashout history before
          starting another request.
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="btn secondary" onClick={close}>
          Close
        </button>
        {cashout.connected && (
          <button
            type="button"
            className="btn secondary"
            disabled={mutation.isPending}
            onClick={() => void cashout.query.refetch()}
          >
            Refresh status
          </button>
        )}
        <AsyncButton
          type="submit"
          className="btn"
          busy={mutation.isPending}
          busyLabel="Submitting…"
          disabled={
            Boolean(unavailable) || !confirmedDetails || cashout.snapshot?.withdrawableCents === 0
          }
        >
          {retryInput ? 'Retry same request' : 'Submit'}
        </AsyncButton>
      </div>
    </form>
  );
}
