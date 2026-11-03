import {
  FloatingSpotAcceptance,
  FloatingSpotPurchase,
  FloatingSpotQuote,
  FloatingSpotQuoteRequest,
  FloatingSpotReplenished,
  FloatingSpotReplenishment,
  SpotFundingAccountSchema,
  SpotFundingCapabilities,
  SpotFundingOrderDetailSchema,
} from '@opennext/contracts';
import type { z } from 'zod';
import type { ApiClient } from '@/lib/api/client';

/** Approved adapter endpoints. The composition root controls activation. */
export const liveSpotFundingApi = {
  capabilities: (api: ApiClient, signal?: AbortSignal) =>
    api
      .get('/api/billing/spot-funding/capabilities', { signal })
      .then((value) => SpotFundingCapabilities.parse(value)),
  account: (api: ApiClient, signal?: AbortSignal) =>
    api
      .get('/api/billing/spot-funding', { signal })
      .then((value) => SpotFundingAccountSchema.parse(value)),
  order: (api: ApiClient, orderId: string, cursor = '', signal?: AbortSignal) =>
    api
      .get(
        `/api/billing/spot-orders/${encodeURIComponent(orderId)}/funding${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal },
      )
      .then((value) => SpotFundingOrderDetailSchema.parse(value)),
  instance: (api: ApiClient, instanceId: string, cursor = '', signal?: AbortSignal) =>
    api
      .get(
        `/api/instances/${encodeURIComponent(instanceId)}/funding${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal },
      )
      .then((value) => SpotFundingOrderDetailSchema.parse(value)),
  quote: (api: ApiClient, body: z.input<typeof FloatingSpotQuoteRequest>) =>
    api
      .post('/api/billing/spot-quotes', FloatingSpotQuoteRequest.parse(body))
      .then((value) => FloatingSpotQuote.parse(value)),
  purchase: (api: ApiClient, body: z.input<typeof FloatingSpotAcceptance>) =>
    api
      .post('/api/billing/spot-purchases', FloatingSpotAcceptance.parse(body))
      .then((value) => FloatingSpotPurchase.parse(value)),
  replenish: (api: ApiClient, orderId: string, body: z.input<typeof FloatingSpotReplenishment>) =>
    api
      .post(
        `/api/billing/spot-orders/${encodeURIComponent(orderId)}/replenishments`,
        FloatingSpotReplenishment.parse(body),
      )
      .then((value) => FloatingSpotReplenished.parse(value)),
};
