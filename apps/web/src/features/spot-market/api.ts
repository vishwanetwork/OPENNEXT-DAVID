import {
  InferencePresets,
  InferenceQuote,
  InferenceQuoteRequest,
  SpotPurchaseRequest,
  SpotPurchaseResponse,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Spot market writes; offers come from the shared public market query. */
export const spotMarketApi = {
  inferencePresets: (api: ApiClient, offerId: string, signal?: AbortSignal) =>
    api
      .get(`/api/marketplace/inference-presets?offerId=${encodeURIComponent(offerId)}`, { signal })
      .then((r) => InferencePresets.parse(r)),
  inferenceQuote: (
    api: ApiClient,
    offerId: string,
    inferencePresetId: string,
    durationHours: number,
  ) =>
    api
      .post(
        '/api/marketplace/inference-quote',
        InferenceQuoteRequest.parse({ offerId, inferencePresetId, durationHours }),
      )
      .then((r) => InferenceQuote.parse(r)),
  purchase: (api: ApiClient, body: SpotPurchaseRequest) =>
    api
      .post('/api/marketplace/spot-purchases', SpotPurchaseRequest.parse(body))
      .then((r) => SpotPurchaseResponse.parse(r)),
};
