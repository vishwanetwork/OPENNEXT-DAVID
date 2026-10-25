/** Manual credit top-up review calls (`/api/admin/topups`). */
import { TopupReviewResponse, TopupsResponse } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';
import { assertScope, topupEndpoint, type TopupScope } from './topups';

export const topupsApi = {
  list: async (api: ApiClient, scope: TopupScope, signal?: AbortSignal) => {
    const parsed = TopupsResponse.safeParse(await api.get(topupEndpoint('', scope), { signal }));
    if (!parsed.success) throw new Error('The server returned an invalid top-up request list.');
    assertScope(scope, parsed.data);
    return parsed.data.requests;
  },
  review: async (
    api: ApiClient,
    scope: TopupScope,
    id: string,
    body: {
      decision: 'Approve' | 'Reject';
      reason: string;
      fundsVerified?: true;
      workspaceId?: string;
    },
  ) =>
    TopupReviewResponse.parse(
      await api.post(topupEndpoint('/' + encodeURIComponent(id) + '/review', scope), body),
    ),
};
