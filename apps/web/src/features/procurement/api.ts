import {
  AgentRequestResponse,
  KybResponse,
  MatchesResponse,
  PublicMarketResponse,
  QuoteInterestResponse,
  QuoteResponse,
  ReferenceCatalogResponse,
  RfqResponse,
  SettlementsResponse,
  SupplyResponse,
  WorkspaceResponse,
  type KybRequest,
  type QuoteRequest,
  type RfqRequest,
  type SupplyRequest,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

const enc = encodeURIComponent;

/** Typed marketplace calls (legacy `OpenNEXTExchange.api` + `OpenNEXTProcurement` writes). */
export const procurementApi = {
  publicMarket: (api: ApiClient) => api.get('/api/marketplace/public').then((r) => PublicMarketResponse.parse(r)),
  referenceCatalog: (api: ApiClient) => api.get('/api/marketplace/reference-catalog').then((r) => ReferenceCatalogResponse.parse(r)),
  mine: (api: ApiClient) => api.get('/api/marketplace/me').then((r) => WorkspaceResponse.parse(r)),
  matches: (api: ApiClient, filters: { model: string; region: string }) =>
    api.get('/api/marketplace/matches?' + new URLSearchParams(filters)).then((r) => MatchesResponse.parse(r)),
  settlements: (api: ApiClient, days: number | 'all') => api.get(`/api/marketplace/settlements?days=${days}`).then((r) => SettlementsResponse.parse(r)),
  submitKyb: (api: ApiClient, body: KybRequest) => api.post('/api/marketplace/kyb', body).then((r) => KybResponse.parse(r)),
  createRfq: (api: ApiClient, body: RfqRequest) => api.post('/api/marketplace/rfqs', body).then((r) => RfqResponse.parse(r)),
  updateRfq: (api: ApiClient, id: string, body: RfqRequest) => api.patch(`/api/marketplace/rfqs/${enc(id)}`, body).then((r) => RfqResponse.parse(r)),
  createSupply: (api: ApiClient, body: SupplyRequest) => api.post('/api/marketplace/supplies', body).then((r) => SupplyResponse.parse(r)),
  requestAgent: (api: ApiClient, id: string) => api.post(`/api/marketplace/supplies/${enc(id)}/agent`, {}).then((r) => AgentRequestResponse.parse(r)),
  submitQuote: (api: ApiClient, rfqId: string, body: QuoteRequest) => api.post(`/api/marketplace/rfqs/${enc(rfqId)}/quotes`, body).then((r) => QuoteResponse.parse(r)),
  decideQuote: (api: ApiClient, rfqId: string, quoteId: string, decision: 'accept' | 'reject') =>
    api.post(`/api/marketplace/rfqs/${enc(rfqId)}/quotes/${enc(quoteId)}/${decision}`, {}),
  quoteInterest: (api: ApiClient, supplyId: string) => api.post('/api/marketplace/quote-interest', { supplyId }).then((r) => QuoteInterestResponse.parse(r)),
};
