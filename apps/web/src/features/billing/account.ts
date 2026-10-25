/**
 * Verified credit account (legacy exchange.js billing section). Balances change only when the
 * server returns a confirmed snapshot for the signed-in account; outages keep the last one.
 */
import { BillingAccount, type SessionUser, type WorkspaceNotification } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';
import { useSessionStore } from '@/lib/session-store';
import { useWorkspaceStore } from '@/features/terminal/store';
import { mergeNotifications } from '@/features/procurement/exchange';

let client: ApiClient | null = null;
export const setBillingApi = (api: ApiClient | null) => {
  client = api;
};

interface AccountState {
  identity: string;
  pending: Promise<BillingAccount | null> | null;
  confirmed: boolean;
}
let current: AccountState | null = null;

const creditAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));

/** Identity of the account whose credit is loaded ('' when nobody is signed in / onboarded). */
export function billingIdentity(user: SessionUser | null = useSessionStore.getState().user, demo = Boolean(client?.demo)): string {
  const workspaceId = useWorkspaceStore.getState().identity.id;
  return user?.id && user.onboardingCompleted && workspaceId === user.id ? JSON.stringify([user.id, String(user.role || '').toLowerCase(), !!user.demo || demo]) : '';
}

/** Applies the merged notification list to the workspace store. */
export function syncNotifications(marketplaceRows?: WorkspaceNotification[]) {
  const store = useWorkspaceStore.getState();
  const owner = useSessionStore.getState().user?.id;
  const marketplace = (marketplaceRows !== undefined ? marketplaceRows : store.marketplaceNotifications) as WorkspaceNotification[];
  const billing = store.billingNotifications as WorkspaceNotification[];
  const merged = owner && store.identity.id === owner ? mergeNotifications(owner, marketplace, billing) : [];
  store.patch({ marketplaceNotifications: marketplace, notifications: merged });
}

function billingState(): AccountState | null {
  const identity = billingIdentity();
  if (!current || current.identity !== identity) {
    const user = identity ? useSessionStore.getState().user : null;
    current = { identity, pending: null, confirmed: false };
    const paidCredit = creditAmount(user?.fundedCredit) ? user!.fundedCredit! : 0;
    const promotionalCredit = creditAmount(user?.promotionalCredit) ? user!.promotionalCredit : 0;
    useWorkspaceStore.getState().patch({
      billingAccountId: null,
      billingAccountConfirmed: false,
      topupRequests: [],
      billingNotifications: [],
      paidCredit,
      promotionalCredit,
      balance: paidCredit + promotionalCredit,
    });
    syncNotifications();
  }
  return current;
}

export function applyBillingAccount(result: unknown): BillingAccount | null {
  const state = billingState();
  const user = useSessionStore.getState().user;
  if (!state?.identity || !user) return null;
  const parsed = BillingAccount.safeParse(result);
  const value = parsed.success ? parsed.data : null;
  if (
    !value ||
    value.confirmed !== true ||
    value.accountId !== user.id ||
    value.currency !== 'USD' ||
    !(['availableCredit', 'paidCredit', 'promotionalCredit'] as const).every((key) => creditAmount(value[key]))
  )
    throw new Error('The verified credit account response is incomplete.');
  state.confirmed = true;
  useWorkspaceStore.getState().patch({
    balance: value.availableCredit,
    paidCredit: value.paidCredit,
    promotionalCredit: value.promotionalCredit,
    billingAccountId: value.accountId,
    billingAccountConfirmed: true,
    topupRequests: value.requests.filter((row) => row && typeof row.id === 'string' && row.accountId === user.id && (!row.ownerId || row.ownerId === user.id)),
    billingNotifications: value.notifications.filter((row) => row && typeof row.id === 'string' && row.ownerId === user.id) as WorkspaceNotification[],
  });
  syncNotifications();
  window.dispatchEvent?.(new CustomEvent('opennext:billing', { detail: { accountId: user.id } }));
  return value;
}

/** GET /api/billing/account for the current identity; concurrent calls share one request. */
export async function refreshBillingAccount(): Promise<BillingAccount | null> {
  const state = billingState();
  if (!state?.identity) return null;
  if (state.pending) return state.pending;
  if (!client) throw new Error('Credit account updates are unavailable. Please try again later.');
  const identity = state.identity;
  const api = client;
  const job = (async () => {
    try {
      const result = await api.get('/api/billing/account');
      if (current !== state || billingIdentity() !== identity) return null;
      return applyBillingAccount(result);
    } finally {
      if (current === state) state.pending = null;
    }
  })();
  state.pending = job;
  return job;
}

export const hasVerifiedBillingAccount = (): boolean => Boolean(current && current.confirmed && current.identity === billingIdentity());
export const invalidateBillingAccount = () => {
  current = null;
};
