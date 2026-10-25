/** Contact inbox calls (`/api/admin/contacts`). */
import { LeadsResponse, LeadUpdateResponse } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export const leadsApi = {
  list: async (api: ApiClient, signal?: AbortSignal) => {
    const data = await api.get('/api/admin/contacts', { signal });
    const parsed = LeadsResponse.safeParse(data);
    if (!parsed.success)
      throw new Error('The server returned an invalid contact request list. Please refresh.');
    return parsed.data.leads;
  },
  update: async (
    api: ApiClient,
    id: string,
    body: { status: string; note: string; updatedAt: string },
  ) =>
    LeadUpdateResponse.parse(
      await api.patch('/api/admin/contacts/' + encodeURIComponent(id), body),
    ),
};
