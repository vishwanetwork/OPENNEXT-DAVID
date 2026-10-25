import { AuthConfig, EmailRequestResponse, SessionResponse, type SessionUser } from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export const authApi = {
  session: (api: ApiClient) => api.get('/api/auth/session').then((v) => SessionResponse.parse(v).user),
  config: (api: ApiClient) => api.get('/api/auth/config').then((v) => AuthConfig.parse(v)),
  requestEmailCode: (api: ApiClient, email: string) => api.post('/api/auth/email/request', { email }).then((v) => EmailRequestResponse.parse(v)),
  verifyEmailCode: (api: ApiClient, challengeId: string, code: string) =>
    api.post('/api/auth/email/verify', { challengeId, code }).then((v) => SessionResponse.parse(v).user as SessionUser),
  logout: (api: ApiClient) => api.post('/api/auth/logout', {}),
  switchRole: (api: ApiClient, role: 'buyer' | 'seller') => api.post('/api/auth/role', { role }).then((v) => SessionResponse.parse(v).user),
  onboarding: (api: ApiClient, role: 'buyer' | 'seller') => api.post('/api/auth/onboarding', { role }).then((v) => SessionResponse.parse(v).user),
};
