import {
  PricesResponse,
  CollectionRun,
  ProvidersResponse,
  RunsResponse,
  type AdminAccess,
  type PricingProvider,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

const BASE = '/api/admin/pricing/';

export const pricingAdminApi = {
  providers: async (api: ApiClient, signal?: AbortSignal) => {
    const data = ProvidersResponse.parse(await api.get(BASE + 'providers', { signal }));
    return { providers: data.providers, access: data.access || { mutable: false } };
  },
  runs: async (api: ApiClient, signal?: AbortSignal) =>
    RunsResponse.parse(await api.get(BASE + 'runs', { signal })).runs,
  run: async (api: ApiClient, id: string) =>
    CollectionRun.parse(await api.get(BASE + 'runs/' + encodeURIComponent(id))),
  startRun: async (api: ApiClient, id: string) =>
    CollectionRun.parse(await api.post(BASE + 'providers/' + encodeURIComponent(id) + '/run', {})),
  test: async (api: ApiClient, id: string) =>
    CollectionRun.parse(await api.post(BASE + 'providers/' + encodeURIComponent(id) + '/test', {})),
  settings: (api: ApiClient, id: string, body: { enabled: boolean; intervalMinutes: number }) =>
    api.patch(BASE + 'providers/' + encodeURIComponent(id), body),
  credential: (api: ApiClient, id: string, credential: string) =>
    api.post(BASE + 'providers/' + encodeURIComponent(id) + '/credential', { credential }),
  prices: async (api: ApiClient, id: string, signal?: AbortSignal) =>
    PricesResponse.parse(
      await api.get('/api/pricing/prices?provider=' + encodeURIComponent(id) + '&limit=100', {
        signal,
      }),
    ),
};

export type ProviderState = string;
export const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  completed_with_gaps: 'Completed with gaps',
  failed: 'Failed',
  needs_credentials: 'Needs credential',
  not_implemented: 'Setup required',
  not_synced: 'Not synced',
  disabled: 'Disabled',
  cancelled: 'Cancelled',
};
export const providerRun = (p: PricingProvider) => p.latestRun ?? p.lastRun;
export const credentialReady = (p: PricingProvider) =>
  !p.credentialRequired || (p.credentialConfigured ?? p.configured) === true;
export const providerState = (p: PricingProvider): string =>
  providerRun(p)?.status || p.status || 'not_synced';

export const PRICE_TERMS = ['Spot', 'On-demand', 'Reserved'] as const;
export function providerTerms(p: PricingProvider) {
  const supported = p.supportedTerms ?? p.capabilities ?? [];
  return PRICE_TERMS.map((term) => ({
    term,
    supported: p.adapterStatus === 'implemented' && supported.includes(term),
  }));
}

export type ProviderFilter = 'all' | 'connected' | 'enabled' | 'attention';

export function filterProviders(
  providers: PricingProvider[],
  query: string,
  filter: ProviderFilter,
): PricingProvider[] {
  const q = query.toLowerCase();
  return providers.filter(
    (p) =>
      (p.name + ' ' + p.id).toLowerCase().includes(q) &&
      (filter === 'all' ||
        (filter === 'enabled' && p.enabled) ||
        (filter === 'connected' && p.adapterStatus === 'implemented' && credentialReady(p)) ||
        (filter === 'attention' &&
          ['failed', 'completed_with_gaps', 'needs_credentials', 'not_implemented'].includes(
            providerState(p),
          ))),
  );
}

export function providerMetrics(providers: PricingProvider[]) {
  return {
    providers: providers.length,
    connected: providers.filter((p) => p.adapterStatus === 'implemented' && credentialReady(p))
      .length,
    records: providers.reduce((n, p) => n + (Number(p.recordCount) || 0), 0),
    running: providers.filter((p) => providerState(p) === 'running').length,
  };
}

export const fmt = (t: string | null | undefined): string =>
  t
    ? new Date(t).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not collected yet';

export type { AdminAccess };
