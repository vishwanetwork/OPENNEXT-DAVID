'use client';

/**
 * Server records of the terminal, owned by TanStack Query. Every `/api/*` read used by the
 * workspace has exactly one hook here; features derive their views with `useMemo`/`select`
 * and refresh after writes with `useInvalidateWorkspace()`. The legacy 30 s refresh loop is
 * `refetchInterval` (visible tab only); a failed refetch keeps the last snapshot.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingAccount,
  CreditTopup,
  SessionUser,
  WorkspaceNotification,
  WorkspaceResponse,
} from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useApp } from '@/components/providers/app-context';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import { workspaceApi } from './api';
import { mergeNotifications } from './notifications';
import { useWorkspaceStore } from './store';
import { asRole } from './types';

const REFRESH = { refetchInterval: 30_000, refetchIntervalInBackground: false, retry: 1 } as const;

/** Identity of the signed-in, onboarded account: id + role + demo scope ('' when anonymous). */
export function accountIdentity(user: SessionUser | null, demo: boolean): string {
  return user?.id && user.onboardingCompleted
    ? JSON.stringify([user.id, asRole(user.role), !!user.demo || demo])
    : '';
}

export function useAccountIdentity(): string {
  const user = useSessionStore((s) => s.user);
  const { demo } = useApp();
  return accountIdentity(user, demo);
}

/** Public marketplace records (`GET /api/marketplace/public`). */
export function usePublicMarket() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.marketplace.public,
    queryFn: () => workspaceApi.publicMarket(api),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    ...REFRESH,
  });
}

/** Read-only reference listings; never requested in the demo workspace. */
export function useReferenceCatalog() {
  const api = useApi();
  const { demo } = useApp();
  const user = useSessionStore((s) => s.user);
  return useQuery({
    queryKey: queryKeys.marketplace.reference,
    queryFn: () => workspaceApi.referenceCatalog(api),
    enabled: !demo && !user?.demo,
    staleTime: Infinity,
    retry: 1,
  });
}

/** Records owned by the signed-in account (`GET /api/marketplace/me`). */
export function useWorkspace() {
  const api = useApi();
  const identity = useAccountIdentity();
  return useQuery({
    queryKey: queryKeys.account.workspace(identity),
    queryFn: () => workspaceApi.mine(api),
    enabled: Boolean(identity),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    ...REFRESH,
  });
}

export const EMPTY_WORKSPACE: WorkspaceResponse = {
  rfqs: [],
  listings: [],
  review: { status: 'Not started', step: 0 },
  responses: [],
  orders: [],
  notifications: [],
  instances: [],
};

/** Workspace records with an empty fallback so pages can render before the first load. */
export function useWorkspaceData(): WorkspaceResponse {
  return useWorkspace().data ?? EMPTY_WORKSPACE;
}

/** Same-model recommendations for the current filters (`GET /api/marketplace/matches`). */
export function useMatches() {
  const api = useApi();
  const identity = useAccountIdentity();
  const model = useWorkspaceStore((s) => s.model);
  const region = useWorkspaceStore((s) => s.region);
  return useQuery({
    queryKey: queryKeys.account.matches(identity, model, region),
    queryFn: () => workspaceApi.matches(api, { model, region }),
    enabled: Boolean(identity),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    ...REFRESH,
  });
}

/** Recently settled marketplace history (`GET /api/marketplace/settlements`). */
export function useSettlements(days: number | 'all' = 90) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.marketplace.settlements(days),
    queryFn: () => workspaceApi.settlements(api, days),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    ...REFRESH,
  });
}

const creditAmount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100));

/** A billing snapshot counts only when the server confirms it for this exact account. */
export function confirmedBillingAccount(
  value: BillingAccount | null | undefined,
  user: SessionUser | null,
): BillingAccount | null {
  if (!value || !user) return null;
  if (
    value.confirmed !== true ||
    value.accountId !== user.id ||
    value.currency !== 'USD' ||
    !(['availableCredit', 'paidCredit', 'promotionalCredit'] as const).every((key) =>
      creditAmount(value[key]),
    )
  )
    return null;
  return {
    ...value,
    requests: value.requests.filter(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        row.accountId === user.id &&
        (!row.ownerId || row.ownerId === user.id),
    ),
    notifications: value.notifications.filter(
      (row) => row && typeof row.id === 'string' && row.ownerId === user.id,
    ),
  };
}

/** Verified credit account (`GET /api/billing/account`); `data` is null until confirmed. */
export function useBillingAccount() {
  const api = useApi();
  const identity = useAccountIdentity();
  const user = useSessionStore((s) => s.user);
  return useQuery({
    queryKey: queryKeys.account.billing(identity),
    queryFn: () => workspaceApi.billingAccount(api),
    enabled: Boolean(identity),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    select: (value) => confirmedBillingAccount(value, user),
    ...REFRESH,
  });
}

export interface Balance {
  available: number;
  paid: number;
  promotional: number;
  earnings: number;
  /** True once the server confirmed the account; false means the session fallback is shown. */
  confirmed: boolean;
  accountId: string | null;
}

/** The one balance model: confirmed billing account, else the session's credits. */
export function useBalance(): Balance {
  const user = useSessionStore((s) => s.user);
  const account = useBillingAccount().data ?? null;
  return useMemo(() => {
    if (account)
      return {
        available: account.availableCredit,
        paid: account.paidCredit,
        promotional: account.promotionalCredit,
        earnings: creditAmount((account as { earningsBalance?: unknown }).earningsBalance)
          ? ((account as { earningsBalance?: number }).earningsBalance as number)
          : 0,
        confirmed: true,
        accountId: account.accountId,
      };
    const paid = creditAmount(user?.fundedCredit) ? user!.fundedCredit! : 0;
    const promotional = creditAmount(user?.promotionalCredit) ? user!.promotionalCredit : 0;
    return {
      available: paid + promotional,
      paid,
      promotional,
      earnings: 0,
      confirmed: false,
      accountId: null,
    };
  }, [account, user]);
}

/** Credit top-up requests of the signed-in account. */
export function useTopupRequests(): CreditTopup[] {
  const account = useBillingAccount().data ?? null;
  return account?.requests ?? EMPTY_TOPUPS;
}
const EMPTY_TOPUPS: CreditTopup[] = [];

/** Marketplace + billing notifications owned by the signed-in account, newest first. */
export function useNotifications(): WorkspaceNotification[] {
  const user = useSessionStore((s) => s.user);
  const workspace = useWorkspace().data;
  const account = useBillingAccount().data ?? null;
  return useMemo(
    () =>
      mergeNotifications(
        user?.id,
        workspace?.notifications ?? [],
        (account?.notifications ?? []) as WorkspaceNotification[],
      ),
    [user?.id, workspace?.notifications, account?.notifications],
  );
}

/** Refetches every account and marketplace record (after a server write, role switch…). */
export function useInvalidateWorkspace() {
  const client = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.account.all }),
        client.invalidateQueries({ queryKey: queryKeys.marketplace.all }),
      ]).then(() => undefined),
    [client],
  );
}

/** Runs a server write, then refreshes the workspace (legacy `runServer`). */
export function useRunServer() {
  const invalidate = useInvalidateWorkspace();
  return useCallback(
    async <T>(work: () => Promise<T>): Promise<T> => {
      const result = await work();
      await invalidate();
      return result;
    },
    [invalidate],
  );
}

/* ---------- public-site intents ---------- */

export type IntentResumer = (intent: {
  kind: 'listing' | 'opportunity';
  id: string;
  intent: 'buy' | 'offer';
}) => boolean | void;

/**
 * Resumes `?listing=&intent=` / `?opportunity=&intent=` requests carried over from the public
 * site once the account is onboarded (opportunities additionally wait for the workspace
 * records). A handler returning `false` keeps the intent pending.
 */
export function useIntentResume(handler: IntentResumer) {
  const identity = useAccountIdentity();
  const pendingListing = useWorkspaceStore((s) => s.pendingListing);
  const pendingOpportunity = useWorkspaceStore((s) => s.pendingOpportunity);
  const loaded = useWorkspace().isSuccess;
  useEffect(() => {
    if (!identity) return;
    const state = useWorkspaceStore.getState();
    if (pendingListing) {
      const handled = handler({ kind: 'listing', ...pendingListing });
      if (handled !== false) state.patch({ pendingListing: null });
    }
    if (pendingOpportunity && loaded) {
      const handled = handler({ kind: 'opportunity', ...pendingOpportunity });
      if (handled !== false) state.patch({ pendingOpportunity: null });
    }
  }, [identity, pendingListing, pendingOpportunity, loaded, handler]);
}

/** True inside the isolated demo workspace (route or sandbox session). */
export function useIsDemo(): boolean {
  const { demo } = useApp();
  const sessionDemo = useSessionStore((s) => Boolean(s.user?.demo));
  return demo || sessionDemo;
}

/** Refetches the verified credit account and returns the confirmed snapshot (null if unconfirmed). */
export function useRefreshBillingAccount() {
  const client = useQueryClient();
  const identity = useAccountIdentity();
  const user = useSessionStore((s) => s.user);
  return useCallback(async (): Promise<BillingAccount | null> => {
    if (!identity) return null;
    const key = queryKeys.account.billing(identity);
    await client.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
    return confirmedBillingAccount(client.getQueryData<BillingAccount>(key), user);
  }, [client, identity, user]);
}
