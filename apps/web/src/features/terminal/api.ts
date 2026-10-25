import { DemoSessionResponse } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Isolated demo workspace session calls (`/api/demo/*`). */
export const demoApi = {
  start: (api: ApiClient, role: 'buyer' | 'seller') =>
    api
      .request('/api/demo/start', { method: 'POST', body: { role }, timeoutMs: 15_000 })
      .then((r) => DemoSessionResponse.parse(r)),
  switchRole: (api: ApiClient, role: 'buyer' | 'seller') =>
    api
      .request('/api/demo/auth/role', { method: 'POST', body: { role }, timeoutMs: 15_000 })
      .then((r) => DemoSessionResponse.parse(r)),
  logout: (api: ApiClient) =>
    api.request('/api/demo/auth/logout', { method: 'POST', body: {}, timeoutMs: 3_000 }),
};
