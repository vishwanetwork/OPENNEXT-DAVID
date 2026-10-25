import {
  HistoryCatalog,
  HistoryResponse,
  NewsResponse,
  PricesResponse,
  RegionalHistoryResponse,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export const marketApi = {
  prices: (api: ApiClient) =>
    api
      .get('/api/pricing/prices?limit=5000', { timeoutMs: 10_000 })
      .then((v) => PricesResponse.parse(v)),
  historyCatalog: (api: ApiClient) =>
    api
      .get('/api/pricing/history-catalog', { timeoutMs: 10_000 })
      .then((v) => HistoryCatalog.parse(v)),
  history: (api: ApiClient, query: string) =>
    api
      .get('/api/pricing/history?' + query, { timeoutMs: 10_000 })
      .then((v) => HistoryResponse.parse(v)),
  regionalHistory: (api: ApiClient, query: string) =>
    api
      .get('/api/pricing/regional-history?' + query, { timeoutMs: 15_000 })
      .then((v) => RegionalHistoryResponse.parse(v)),
  importedHistory: (api: ApiClient, query: string) =>
    api
      .get('/api/pricing/imported-history?' + query, { timeoutMs: 15_000 })
      .then((v) => RegionalHistoryResponse.parse(v)),
  news: (api: ApiClient) =>
    api.get('/api/news', { timeoutMs: 20_000 }).then((v) => NewsResponse.parse(v)),
};
