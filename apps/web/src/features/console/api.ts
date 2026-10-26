import {
  AdminSessionOk,
  MarketplaceSnapshot,
  ProvidersResponse,
  PricesResponse,
  TopupsResponse,
  LeadsResponse,
  PublicMarketResponse,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

function requireLists(raw: unknown, names: string[]): unknown {
  if (
    !raw ||
    typeof raw !== 'object' ||
    names.some((name) => !Array.isArray(Reflect.get(raw, name)))
  )
    throw new Error('The backend returned an incomplete operations snapshot.');
  return raw;
}

/** Console-wide administrator session endpoints. Page-specific calls live in each console-* feature. */
export const adminApi = {
  /** Exchanges the server administrator token for the HttpOnly session cookie. */
  login: async (api: ApiClient, token: string) =>
    AdminSessionOk.parse(await api.post('/api/admin/pricing/session', { token })),
  marketplace: async (api: ApiClient, signal?: AbortSignal) => {
    const result = MarketplaceSnapshot.parse(
      requireLists(await api.get('/api/admin/marketplace', { signal }), [
        'rfqs',
        'supplies',
        'kyb',
        'featured',
      ]),
    );
    if (result.scope === 'demo') throw new Error('Live operations received a demo snapshot.');
    return result;
  },
  providers: async (api: ApiClient, signal?: AbortSignal) =>
    ProvidersResponse.parse(await api.get('/api/admin/pricing/providers', { signal })),
  prices: async (api: ApiClient, signal?: AbortSignal, filters: Record<string, string> = {}) =>
    PricesResponse.parse(
      requireLists(
        await api.get('/api/pricing/prices?' + new URLSearchParams({ limit: '5000', ...filters }), {
          signal,
        }),
        ['records'],
      ),
    ),
  topups: async (api: ApiClient, signal?: AbortSignal) => {
    const result = TopupsResponse.parse(await api.get('/api/admin/topups', { signal }));
    if (result.scope === 'demo' || result.requests.some((r) => r.demo || r.workspaceId))
      throw new Error('Live operations received demo top-up requests.');
    return result;
  },
  contacts: async (api: ApiClient, signal?: AbortSignal) =>
    LeadsResponse.parse(await api.get('/api/admin/contacts', { signal })),
  publicMarket: async (api: ApiClient, signal?: AbortSignal) =>
    PublicMarketResponse.parse(
      requireLists(await api.get('/api/marketplace/public', { signal }), ['supplies', 'rfqs']),
    ),
};
