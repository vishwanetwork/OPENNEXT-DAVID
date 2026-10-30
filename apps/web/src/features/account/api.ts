import {
  SshKeyAddRequest,
  SshKeyAddResponse,
  SshKeyListResponse,
  SshKeyRemoveResponse,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Account SSH key library (`/api/account/ssh-keys`). */
export const accountApi = {
  sshKeys: (api: ApiClient) =>
    api.get('/api/account/ssh-keys').then((r) => SshKeyListResponse.parse(r)),
  addSshKey: (api: ApiClient, body: { label: string; publicKey: string }) =>
    api
      .post('/api/account/ssh-keys', SshKeyAddRequest.parse(body))
      .then((r) => SshKeyAddResponse.parse(r)),
  removeSshKey: (api: ApiClient, id: string) =>
    api
      .delete(`/api/account/ssh-keys/${encodeURIComponent(id)}`)
      .then((r) => SshKeyRemoveResponse.parse(r)),
};
