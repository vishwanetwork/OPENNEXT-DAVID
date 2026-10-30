import { SpotPurchaseRequest, SpotPurchaseResponse } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Spot market writes; offers come from the shared public market query. */
export const spotMarketApi = {
  purchase: (api: ApiClient, body: SpotPurchaseRequest) =>
    api
      .post('/api/marketplace/spot-purchases', SpotPurchaseRequest.parse(body))
      .then((r) => SpotPurchaseResponse.parse(r)),
};
