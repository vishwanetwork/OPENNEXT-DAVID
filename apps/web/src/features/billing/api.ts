import { CheckoutResponse, CreditTopupGetResponse, CreditTopupResponse, type CheckoutRequest, type CreditTopupCreateRequest } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export const billingApi = {
  createTopup: (api: ApiClient, body: CreditTopupCreateRequest) => api.post('/api/billing/topups', body).then((r) => CreditTopupResponse.parse(r)),
  getTopup: (api: ApiClient, id: string) => api.get(`/api/billing/topups/${encodeURIComponent(id)}`).then((r) => CreditTopupGetResponse.parse(r)),
  /** Provider checkout; the server answers 503 PAYMENTS_NOT_CONFIGURED until a provider is connected. */
  checkout: (api: ApiClient, body: CheckoutRequest) => api.post('/api/billing/checkout', body).then((r) => CheckoutResponse.parse(r)),
};
