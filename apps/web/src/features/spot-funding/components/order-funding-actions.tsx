'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FloatingSpotReplenishment } from '@opennext/contracts';
import type { z } from 'zod';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { useOpenVerifiedBankTransfer } from '@/features/bank-transfer';
import { describeError } from '@/lib/api/errors';
import { useSessionStore } from '@/lib/session-store';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { useAccountIdentity, useTerminal } from '@/terminal-kit';
import { dollarCents } from '../amounts';
import { liveSpotFundingApi } from '../live-api';

type Pending = z.infer<typeof FloatingSpotReplenishment>;
function stored(key: string): Pending | undefined {
  try {
    const parsed = FloatingSpotReplenishment.safeParse(
      JSON.parse(sessionStorage.getItem(key) || 'null'),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function OrderFundingActions({ order }: { order: SpotFundingOrder }) {
  const identity = useAccountIdentity();
  if (order.runtimeState === 'ended' || order.maxTotalCents === undefined) return null;
  if (order.totalFundedCents !== undefined && order.totalFundedCents >= order.maxTotalCents)
    return (
      <p className="spot-funding-note">
        Your accepted total funding limit is fully allocated. Remaining confirmed funds can still
        cover usage, but this agreement cannot accept additional funding.
      </p>
    );
  return <FundingForm key={`${identity}:${order.orderId}`} order={order} identity={identity} />;
}

function FundingForm({ order, identity }: { order: SpotFundingOrder; identity: string }) {
  const api = useApi();
  const { openModal } = useTerminal();
  const openTransfer = useOpenVerifiedBankTransfer();
  const client = useQueryClient();
  const userId = useSessionStore((s) => s.user?.id);
  const storageKey = `opennext:spot-replenishment:${identity}:${order.orderId}`;
  const [pending, setPending] = useState(() => stored(storageKey));
  const suggested = Math.max(
    100,
    (order.funding.nextHourRequiredCents ?? 100) -
      order.funding.remainingCents +
      Math.max(0, (order.storageReserveTargetCents ?? 0) - (order.storageReserveCents ?? 0)),
  );
  const [amount, setAmount] = useState(((pending?.amountCents ?? suggested) / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const lock = useRef(false);
  const active = () => {
    const state = useSessionStore.getState();
    return (
      state.status === 'verified' &&
      state.user?.id === userId &&
      state.user?.role === 'buyer' &&
      !state.user?.demo
    );
  };
  const submit = async () => {
    if (lock.current || !active()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body = pending ?? {
        amountCents: dollarCents(amount),
        idempotencyKey: crypto.randomUUID(),
      };
      setPending(body);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(body));
      } catch {
        /* Retained in this tab. */
      }
      const result = await liveSpotFundingApi.replenish(api, order.orderId, body);
      if (!active()) return;
      if (
        result.accountId !== userId ||
        (result.order && result.order.orderId !== order.orderId) ||
        (result.transfer &&
          (result.transfer.orderId !== order.orderId ||
            result.transfer.amountCents !== body.amountCents))
      )
        throw new Error('The funding receipt could not be matched to your order.');
      if (result.transfer) openTransfer(result.transfer);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* No financial state is stored here. */
      }
      setPending(undefined);
      setSuccess(
        result.transfer
          ? 'Payment instructions created. Funds apply after confirmation.'
          : 'Credit allocated. The Agent will check funding and recovery readiness.',
      );
      void client.invalidateQueries({ queryKey: ['account'] });
    } catch (cause) {
      if (active()) setError(describeError(cause).message);
    } finally {
      lock.current = false;
      if (active()) setBusy(false);
    }
  };
  return (
    <details className="spot-funding-help">
      <summary>Replenish this {order.paymentMethod} order</summary>
      <p className="form-note">
        {order.paymentMethod === 'Direct Pay'
          ? 'This transfer funds this order only. Adding shared Credit does not fund a Direct Pay order.'
          : 'Allocate existing available Credit within your accepted total budget, or top up your shared wallet.'}
      </p>
      <label className="form-label">
        Amount (USD)
        <input
          className="field"
          inputMode="decimal"
          value={amount}
          disabled={busy || Boolean(pending)}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {pending ? (
        <p role="status">
          A funding request is pending. Retry its confirmation before creating another request.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-note">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="form-note">
          {success}
        </p>
      ) : null}
      {busy ? <AsyncFeedback>Confirming order funding…</AsyncFeedback> : null}
      <div className="spot-funding-actions">
        <AsyncButton
          type="button"
          className="btn small"
          busy={busy}
          disabled={busy}
          onClick={() => void submit()}
        >
          {pending
            ? 'Retry funding confirmation'
            : order.paymentMethod === 'Direct Pay'
              ? 'Create order bank transfer'
              : 'Allocate Credit'}
        </AsyncButton>
        {order.paymentMethod === 'Credit' ? (
          <button
            type="button"
            className="btn secondary small"
            disabled={busy}
            onClick={() => openModal('pay-start')}
          >
            Add Credit
          </button>
        ) : null}
      </div>
    </details>
  );
}
