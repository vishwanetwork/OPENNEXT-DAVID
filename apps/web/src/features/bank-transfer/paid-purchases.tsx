'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PaidPurchasesResponse, RedeemPaidPurchaseResponse } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import { useSessionStore } from '@/lib/session-store';
import { queryKeys } from '@/lib/api/query-keys';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import { useAccountIdentity, useIsDemo } from '@/terminal-kit';

/** Paid receipts are server-owned and never persisted in browser storage. */
export function PaidPurchases() {
  const api = useApi();
  const client = useQueryClient();
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const userId = useSessionStore((s) =>
    s.status === 'verified' && s.user?.role === 'buyer' ? s.user.id : '',
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const query = useQuery({
    queryKey: queryKeys.account.paidPurchases(identity),
    enabled: Boolean(userId && !demo && !api.demo),
    queryFn: async ({ signal }) => {
      const result = PaidPurchasesResponse.parse(
        await api.get('/api/billing/paid-purchases', { signal }),
      );
      if (result.accountId !== userId || result.purchases.some((p) => p.accountId !== userId))
        throw new Error('The paid purchases do not match this account.');
      return result.purchases;
    },
    retry: false,
    gcTime: 0,
    refetchInterval: 15_000,
  });
  const redeem = async (id: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(id);
    setError('');
    try {
      const result = RedeemPaidPurchaseResponse.parse(
        await api.post(`/api/billing/paid-purchases/${encodeURIComponent(id)}/redeem`, {
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      if (
        result.accountId !== userId ||
        result.purchase.accountId !== userId ||
        result.purchase.id !== id
      )
        throw new Error('The paid purchase confirmation does not match this account.');
      if (useSessionStore.getState().user?.id === userId) {
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.account.paidPurchases(identity) }),
          client.invalidateQueries({ queryKey: queryKeys.account.workspace(identity) }),
          client.invalidateQueries({ queryKey: queryKeys.account.billing(identity) }),
        ]);
      }
    } catch (failure) {
      if (useSessionStore.getState().user?.id === userId) setError(describeError(failure).message);
    } finally {
      locked.current = false;
      setBusy('');
    }
  };
  if (!userId || demo || api.demo) return null;
  if (query.error)
    return (
      <p role="alert">
        {isUnauthorized(query.error)
          ? 'Sign in again to view paid purchases.'
          : 'Paid purchases could not be loaded. Refresh to try again.'}
      </p>
    );
  if (query.isPending) return <AsyncFeedback>Checking paid purchases…</AsyncFeedback>;
  const purchases =
    query.data?.filter((p) => p.state === 'awaiting_customer_order' || p.state === 'redeeming') ??
    [];
  if (!purchases.length) return null;
  return (
    <section className="panel" aria-label="Paid purchases awaiting your order">
      <h2>Payment complete — continue your purchase</h2>
      <p>
        Your original price is locked. No additional payment or Credit debit is required. Spot
        capacity is confirmed when the instance starts; if it cannot start, the full payment returns
        to Credit.
      </p>
      {purchases.map((p) => (
        <article className="instance-card" key={p.id}>
          <h3>
            {p.gpuCount} × {p.model} · {p.region}
          </h3>
          <p>
            {p.durationHours} hours · ${(p.amountCents / 100).toFixed(2)} paid
          </p>
          <p>Add your SSH public key using SSH keys below before connecting.</p>
          <AsyncButton
            type="button"
            className="btn"
            busy={busy === p.id || p.state === 'redeeming'}
            disabled={Boolean(busy) || p.state !== 'awaiting_customer_order'}
            onClick={() => void redeem(p.id)}
          >
            {p.state === 'redeeming'
              ? 'Submitting your paid order…'
              : 'Continue purchase — already paid'}
          </AsyncButton>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
