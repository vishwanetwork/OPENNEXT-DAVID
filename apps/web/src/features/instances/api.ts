import {
  InstanceEndRequest,
  InstanceEndResponse,
  InstanceSshKeysRequest,
  InstanceSshKeysResponse,
  ResellResponse,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Instance actions and key sets; the instance list comes from the workspace (`/api/marketplace/me`). */
export const instancesApi = {
  resell: (api: ApiClient, id: string, body: { count: number; rate: number; hours: number }) =>
    api
      .post(`/api/marketplace/instances/${encodeURIComponent(id)}/resell`, body)
      .then((r) => ResellResponse.parse(r)),
  sshKeys: (api: ApiClient, id: string, signal?: AbortSignal) =>
    api
      .get(`/api/marketplace/instances/${encodeURIComponent(id)}/ssh-keys`, { signal })
      .then((r) => InstanceSshKeysResponse.parse(r)),
  /** Replaces the instance's keys; the server installs them within about 15 seconds. */
  setSshKeys: (api: ApiClient, id: string, keys: string[]) =>
    api
      .post(
        `/api/marketplace/instances/${encodeURIComponent(id)}/ssh-keys`,
        InstanceSshKeysRequest.parse({ keys }),
      )
      .then((r) => InstanceSshKeysResponse.parse(r)),
  end: (api: ApiClient, id: string) =>
    api
      .post(
        `/api/marketplace/instances/${encodeURIComponent(id)}/end`,
        InstanceEndRequest.parse({ confirmation: 'END' }),
      )
      .then((r) => InstanceEndResponse.parse(r)),
};
