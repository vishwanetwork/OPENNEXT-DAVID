'use client';

import { useCallback, useMemo } from 'react';
import type { CreditTopup, LedgerEntry, Order, Payout } from '@opennext/contracts';
import { useSessionStore } from '@/lib/session-store';
import {
  useIsDemo,
  useTerminalSlots,
  useTopupRequests,
  useWorkspaceData,
  useWorkspaceStore,
} from '@/terminal-kit';
import type { BillingData } from './analytics';
import { canReturn, ownRequests, paymentIdentity, requestFor } from './payments';
import { useBillingUi } from './ui-store';

/** Records the billing analytics operate on. Ledger / payouts are optional backend extensions. */
export function useBillingData(): BillingData {
  const role = useWorkspaceStore((s) => s.role);
  const workspace = useWorkspaceData();
  const billingUI = useBillingUi();
  return useMemo(() => {
    const extra = workspace as { ledger?: LedgerEntry[]; payouts?: Payout[] };
    return {
      role,
      ledger: extra.ledger ?? [],
      orders: workspace.orders as Order[],
      payouts: extra.payouts ?? [],
      listings: workspace.listings,
      billingUI,
    };
  }, [role, workspace, billingUI]);
}

/** Identity of the signed-in, onboarded account for payment drafts ('' when none). */
export function usePaymentIdentity(): string {
  const user = useSessionStore((s) => s.user);
  const role = useWorkspaceStore((s) => s.role);
  const identityId = useWorkspaceStore((s) => s.identity.id);
  const demo = useIsDemo();
  return paymentIdentity(user, role, identityId, demo);
}

/** Top-up requests of the signed-in account plus the lookups the payment dialogs need. */
export function useOwnTopups() {
  const userId = useSessionStore((s) => s.user?.id);
  const requests = useTopupRequests();
  const own = useMemo(() => ownRequests(requests, userId), [requests, userId]);
  const { purchaseContext } = useTerminalSlots().services;
  const reference = useCallback(
    () => (purchaseContext?.hasPending() ? String(purchaseContext.reference() || '') : ''),
    [purchaseContext],
  );
  return {
    requests: own,
    find: (id: string | undefined): CreditTopup | undefined => requestFor(own, id),
    canReturn: (request: CreditTopup | undefined) => canReturn(request, reference()),
    purchaseReference: reference,
    resumePurchase: () => purchaseContext?.resume(),
  };
}
