import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, demoPath } from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApiClient', () => {
  it('sends JSON, cookies and the CSRF token on writes', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    const api = createApiClient({ fetch: fetchMock, csrfToken: () => 'csrf-1' });
    await api.post('/api/marketplace/rfqs', { a: 1 });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/marketplace/rfqs');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1');
    expect(init.body).toBe('{"a":1}');
  });
  it('surfaces backend error envelopes as ApiError', async () => {
    const api = createApiClient({ fetch: async () => json(409, { error: 'Duplicate submission.' }) });
    await expect(api.post('/api/marketplace/rfqs', {})).rejects.toMatchObject({ status: 409, message: 'Duplicate submission.' });
  });
  it('refuses non-API paths', async () => {
    const api = createApiClient({ fetch: async () => json(200, {}) });
    await expect(api.get('/etc/passwd')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('demo sandbox rules', () => {
  it('maps sandboxed namespaces to /api/demo', () => {
    expect(demoPath('/api/marketplace/me', 'GET')).toEqual({ path: '/api/demo/marketplace/me' });
    expect(demoPath('/api/auth/session', 'GET')).toEqual({ path: '/api/demo/auth/session' });
  });
  it('blocks administration and real writes', () => {
    expect(demoPath('/api/admin/marketplace', 'GET')).toHaveProperty('blocked');
    expect(demoPath('/api/pricing/prices', 'POST')).toHaveProperty('blocked');
    expect(demoPath('/api/pricing/prices', 'GET')).toEqual({ path: '/api/pricing/prices' });
  });
  it('rejects blocked demo calls locally without a network request', async () => {
    const fetchMock = vi.fn();
    const api = createApiClient({ demo: true, fetch: fetchMock });
    await expect(api.get('/api/admin/marketplace')).rejects.toMatchObject({ status: 403, code: 'DEMO_ACTION_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
