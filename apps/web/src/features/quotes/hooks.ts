'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { useSessionStore } from '@/lib/session-store';
import {
  useInvalidateWorkspace,
  useNotifications,
  useTerminal,
  useWorkspaceData,
  useWorkspaceStore,
} from '@/terminal-kit';
import {
  accountRows,
  notices,
  ownerKey,
  prefill,
  quoteRequests,
  type Notice,
  type QuoteOffer,
} from './notifications';
import { useQuoteStore } from './store';

/** Account-scoped notices, quote requests and the refresh loop (legacy `sync()` / `refresh()`). */
export function useQuoteNotifications() {
  const user = useSessionStore((s) => s.user);
  const { demo } = useApp();
  const owner = ownerKey(user, demo);
  const store = useQuoteStore();
  const workspace = useWorkspaceData();
  const rfqs = workspace.rfqs;
  const orders = workspace.orders;
  const notifications = useNotifications();
  const identityId = useWorkspaceStore((s) => s.identity.id);
  const invalidate = useInvalidateWorkspace();
  const sync = store.sync;
  useEffect(() => {
    sync(owner);
  }, [owner, sync]);
  const sameAccount = Boolean(user?.id) && identityId === user?.id;
  const readIds = useMemo(() => new Set(store.readIds), [store.readIds]);
  const rows = useMemo(
    () =>
      notices(
        sameAccount ? accountRows(notifications, 'notifications', user?.id, owner) : [],
        readIds,
      ),
    [notifications, owner, readIds, sameAccount, user?.id],
  );
  const requests = useMemo(
    () => quoteRequests(sameAccount ? accountRows(rfqs, 'rfqs', user?.id, owner) : []),
    [rfqs, owner, sameAccount, user?.id],
  );
  const ownedOrders = useMemo(
    () => (sameAccount ? accountRows(orders, 'orders', user?.id, owner) : []),
    [orders, owner, sameAccount, user?.id],
  );
  const ownedRfqs = useMemo(
    () => (sameAccount ? accountRows(rfqs, 'rfqs', user?.id, owner) : []),
    [rfqs, owner, sameAccount, user?.id],
  );
  const refresh = useCallback(async (force = false) => {
    const state = useQuoteStore.getState();
    if (!state.owner) return;
    if (state.pending) return state.pending;
    if (!force && Date.now() - state.lastLoaded < 15000) return;
    const job = (async () => {
      try {
        await invalidate();
        if (useQuoteStore.getState().owner === state.owner)
          useQuoteStore.getState().patch({ ready: true, error: '', lastLoaded: Date.now() });
      } catch (error) {
        if (useQuoteStore.getState().owner === state.owner)
          useQuoteStore
            .getState()
            .patch({
              error: (error as Error).message || 'Account updates are temporarily unavailable.',
            });
      } finally {
        if (useQuoteStore.getState().owner === state.owner)
          useQuoteStore.getState().patch({ pending: null });
      }
    })();
    state.patch({ pending: job });
    return job;
  }, [invalidate]);
  return { owner, rows, requests, ownedOrders, ownedRfqs, store, refresh };
}

/** Opens the RFQ form prefilled from an On-demand / Reserved offer (legacy `OpenNEXTQuotePreview.open`). */
export function useOpenQuoteRequest() {
  const { openModal, go } = useTerminal();
  const toast = useToast();
  const setPanel = useQuoteStore((s) => s.setPanel);
  return useCallback(
    (offer: QuoteOffer): boolean => {
      const user = useSessionStore.getState().user;
      const identity = useWorkspaceStore.getState().identity;
      if (!user?.onboardingCompleted || identity.id !== user.id) {
        toast('Sign in and complete your account setup to request a quote.');
        go('rfqs');
        return false;
      }
      if (String(user.role).toLowerCase() !== 'buyer') {
        toast('Use a Buyer account to request capacity.');
        return false;
      }
      try {
        const fields = prefill(offer);
        setPanel(false);
        openModal('rfq-form', { prefill: fields });
        return true;
      } catch (error) {
        toast((error as Error).message);
        return false;
      }
    },
    [openModal, go, toast, setPanel],
  );
}

/** Opens the target of a notification (legacy `action('notification')`). */
export function useOpenNotice() {
  const { openModal, go } = useTerminal();
  const { ownedOrders, ownedRfqs, rows, store } = useQuoteNotifications();
  return useCallback(
    (n: Notice) => {
      store.markRead([n.id]);
      store.setPanel(false);
      if (n.topupId) openModal('payment-topup-status', { id: n.topupId });
      else if (n.orderId) {
        if (ownedOrders.some((o) => o.id === n.orderId)) openModal('bill-order', { id: n.orderId });
        else go('billing');
      } else if (n.rfqId && ownedRfqs.some((r) => r.id === n.rfqId))
        openModal('proc-request-details', { id: n.rfqId });
      else {
        store.setPage(Math.floor(rows.findIndex((row) => row.id === n.id) / 20));
        go('notifications');
      }
    },
    [openModal, go, ownedOrders, ownedRfqs, rows, store],
  );
}
