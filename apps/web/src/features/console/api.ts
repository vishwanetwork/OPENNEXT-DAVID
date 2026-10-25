import { AdminSessionOk } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

/** Console-wide administrator session endpoints. Page-specific calls live in each console-* feature. */
export const adminApi = {
  /** Exchanges the server administrator token for the HttpOnly session cookie. */
  login: async (api: ApiClient, token: string) =>
    AdminSessionOk.parse(await api.post('/api/admin/pricing/session', { token })),
};
