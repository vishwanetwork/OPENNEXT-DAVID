import { ResellResponse } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Instance writes; reads come from the shared workspace query (`/api/marketplace/me`). */
export const instancesApi = {
  resell: (api: ApiClient, id: string, body: { count: number; rate: number; hours: number }) =>
    api
      .post(`/api/marketplace/instances/${encodeURIComponent(id)}/resell`, body)
      .then((r) => ResellResponse.parse(r)),
};
