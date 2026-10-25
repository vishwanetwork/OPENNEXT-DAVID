/**
 * Workspace refresh (legacy `OpenNEXTExchange.refresh(S)`): public market, reference catalog,
 * owned records, best matches, billing account and recent settlements. Registered with the
 * terminal shell's 30 s loop by <ProcurementRegistrar>.
 */
import type { OwnedRfq } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';
import { useSessionStore } from '@/lib/session-store';
import { useWorkspaceStore } from '@/features/terminal/store';
import { refreshBillingAccount, syncNotifications } from '@/features/billing/account';
import { procurementApi } from './api';
import { deliveryMethod, isHardware, kindOf, nowIso, useMarketplaceStore } from './exchange';

let client: ApiClient | null = null;
export const setProcurementApi = (api: ApiClient | null) => {
  client = api;
};
export const procurementClient = () => client;
export const isDemo = () => Boolean(client?.demo) || Boolean(useSessionStore.getState().user?.demo);

/** Legacy `init(S)` defaults so older records render completely. */
export function normalizeRfq(r: OwnedRfq): OwnedRfq {
  const record: OwnedRfq = { ...r };
  record.kind ||= 'gpu_rental';
  record.project ||= record.title;
  record.notes ||= 'Confirm the exact GPU, network, storage and delivery window before award.';
  record.urgency ||= 'Standard';
  record.quoteDeadline ||= new Date(Date.now() + 12 * 3600000).toISOString();
  record.start ||= new Date(Date.now() + 24 * 3600000).toISOString();
  record.deliveryMethod ||= deliveryMethod(record);
  if (isHardware(record)) {
    record.hours = 0;
    record.term = 'Physical GPU';
    if (record.deliveryMethod === 'SSH / dedicated instance')
      record.deliveryMethod = deliveryMethod(record);
  }
  record.visibility ||= 'Public requirements';
  record.shareClosingPrice ??= true;
  record.created ||= nowIso();
  record.audit ||= [];
  record.quotes = (record.quotes || []).map((q) => ({ ...q, status: q.status || 'Pending' }));
  return record;
}

const refreshKey = () => {
  const user = useSessionStore.getState().user;
  const S = useWorkspaceStore.getState();
  return JSON.stringify([user?.id || null, user?.role || null, S.model, S.region]);
};

let refreshJob: Promise<void> | null = null;
let refreshIdentity: string | null = null;
let cacheIdentity = '';

export async function refreshMarketplace(): Promise<void> {
  if (!client) return;
  const api = client;
  const userSnapshot = useSessionStore.getState().user;
  const S = useWorkspaceStore.getState();
  const modelSnapshot = S.model;
  const regionSnapshot = S.region;
  const identity = refreshKey();
  const accountKey = JSON.stringify([userSnapshot?.id || null, userSnapshot?.role || null]);
  const market = useMarketplaceStore.getState();
  if (cacheIdentity !== accountKey) {
    market.reset();
    cacheIdentity = accountKey;
  }
  if (refreshJob) {
    if (refreshIdentity === identity) return refreshJob;
    await refreshJob.catch(() => {});
    return refreshMarketplace();
  }
  refreshIdentity = identity;
  refreshJob = (async () => {
    let error = '';
    try {
      const publicMarket = await procurementApi.publicMarket(api);
      market.generated.clear();
      market.set({ market: publicMarket, error: '', loaded: true });
      if (!isDemo() && !useMarketplaceStore.getState().referenceLoaded) {
        try {
          const result = await procurementApi.referenceCatalog(api);
          market.set({
            referenceCatalog: {
              supplies: result.supplies || [],
              rfqs: result.rfqs || [],
              recent: result.recent || [],
            },
            referenceLoaded: true,
          });
        } catch {
          /* Real marketplace data remains available if reference data is offline. */
        }
      }
      const user = userSnapshot;
      if (user?.onboardingCompleted) {
        const own = await procurementApi.mine(api);
        if (refreshKey() !== identity) return;
        const result = await procurementApi.matches(api, {
          model: modelSnapshot,
          region: regionSnapshot,
        });
        if (refreshKey() !== identity) return;
        useWorkspaceStore.getState().patch({
          rfqs: own.rfqs.map(normalizeRfq),
          listings: own.listings,
          review: { ...own.review, step: own.review.step ?? 0 },
          responses: own.responses,
          orders: own.orders,
          instances: own.instances,
        });
        syncNotifications(own.notifications);
        try {
          await refreshBillingAccount();
        } catch {
          /* Retain the last verified credit account while billing is unavailable. */
        }
        if (refreshKey() !== identity) return;
        useWorkspaceStore.getState().patch({ marketplaceAuthoritative: true });
        market.set({
          bestRows: result.rows,
          matchReason: result.reason,
          matchPrompt: result.submissionPrompt || '',
        });
      } else {
        market.set({
          bestRows: [],
          matchReason: 'No matches.',
          matchPrompt: 'Sign in to receive same-model recommendations.',
        });
      }
      const recent = await procurementApi.settlements(api, 90);
      market.set({ recentRows: recent.rows });
    } catch (e) {
      error = (e as Error).message;
      market.set({ error });
      throw e;
    } finally {
      refreshJob = null;
      window.dispatchEvent?.(new CustomEvent('opennext:marketplace', { detail: { error } }));
    }
  })();
  return refreshJob;
}

/** Runs a server write, then refreshes the workspace (legacy `runServer`). */
export async function runServer(work: () => Promise<void>): Promise<void> {
  await work();
  await refreshMarketplace();
}

export { kindOf };
