import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/lib/api/client';
import { liveSpotFundingApi } from './live-api';

describe('floating Spot HTTP adapter', () => {
  it('sends explicit consent through the shared CSRF client and rejects unconfirmed purchases', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ confirmed: false }), { status: 200 }));
    const api = createApiClient({ fetch: transport, csrfToken: () => 'session-csrf' });
    const body = {
      pricingVersion: 'spot-hourly-v1' as const,
      quoteId: 'quote-1',
      idempotencyKey: 'purchase-1',
      consent: true as const,
      storageRetentionAcknowledged: true as const,
      inferenceBillingAcknowledged: false,
      sshPublicKey: null,
    };
    await expect(liveSpotFundingApi.purchase(api, body)).rejects.toThrow();
    expect(transport.mock.calls[0]?.[0]).toBe('/api/billing/spot-purchases');
    const options = transport.mock.calls[0]?.[1];
    expect(new Headers(options?.headers).get('x-csrf-token')).toBe('session-csrf');
    expect(JSON.parse(String(options?.body))).toEqual(body);
  });
  it('does not issue a write when consent is missing', async () => {
    const transport = vi.fn<typeof fetch>();
    const api = createApiClient({ fetch: transport });
    const malformed = {
      pricingVersion: 'spot-hourly-v1' as const,
      quoteId: 'quote-1',
      idempotencyKey: 'purchase-1',
      consent: true as const,
      storageRetentionAcknowledged: true as const,
      inferenceBillingAcknowledged: false,
      sshPublicKey: null,
    };
    Object.assign(malformed, { consent: false });
    expect(() => liveSpotFundingApi.purchase(api, malformed)).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
