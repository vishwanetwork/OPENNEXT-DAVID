import {
  BillingAccount,
  MatchesResponse,
  PublicMarketResponse,
  ReferenceCatalogResponse,
  SettlementsResponse,
  WorkspaceResponse,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Reads of account-owned and public marketplace records. Writes live in the owning features. */
export const workspaceApi = {
  publicMarket: (api: ApiClient) =>
    api.get('/api/marketplace/public').then((r) => PublicMarketResponse.parse(r)),
  referenceCatalog: (api: ApiClient) =>
    api.get('/api/marketplace/reference-catalog').then((r) => ReferenceCatalogResponse.parse(r)),
  mine: (api: ApiClient) => api.get('/api/marketplace/me').then((r) => WorkspaceResponse.parse(r)),
  matches: (api: ApiClient, filters: { model: string; region: string }) =>
    api
      .get('/api/marketplace/matches?' + new URLSearchParams(filters))
      .then((r) => MatchesResponse.parse(r)),
  settlements: (api: ApiClient, days: number | 'all') =>
    api.get(`/api/marketplace/settlements?days=${days}`).then((r) => SettlementsResponse.parse(r)),
  billingAccount: (api: ApiClient) =>
    api.get('/api/billing/account').then((r) => BillingAccount.parse(r)),
};
