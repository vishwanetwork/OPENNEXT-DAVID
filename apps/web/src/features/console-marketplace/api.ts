/** Operations inbox calls (`/api/admin/marketplace`, demo scope included). */
import type { ApiClient } from '@/lib/api/client';
import { inboxEndpoint, normalizeSnapshot, type InboxScope } from './marketplace';

export const marketplaceApi = {
  snapshot: async (api: ApiClient, scope: InboxScope, signal?: AbortSignal) =>
    normalizeSnapshot(await api.get(inboxEndpoint(scope), { signal }), scope),
  decide: (
    api: ApiClient,
    scope: InboxScope,
    collection: 'rfqs' | 'kyb' | 'featured',
    id: string,
    body: Record<string, unknown>,
  ) => api.patch(inboxEndpoint(scope) + '/' + collection + '/' + encodeURIComponent(id), body),
  external: (
    api: ApiClient,
    id: string,
    body: { status: string; reason: string; expectedRevision: number },
  ) => api.patch('/api/admin/marketplace/external/' + encodeURIComponent(id), body),
};
