import { describe, expect, it } from 'vitest';
import {
  AdminInstancesResponse,
  BillingAccount,
  CreditTopup,
  CuratedRfqsResponse,
  InstanceEndResponse,
  InstanceSshKeysResponse,
  MarketplaceReceipt,
  OwnedRfq,
  PriceRecord,
  SessionResponse,
  SettlementsResponse,
  SpotPurchaseRequest,
  SpotPurchaseResponse,
  TickerResponse,
  WorkspaceResponse,
} from './index';

/** Sample payloads from docs/API_CONTRACT.md and legacy/docs/TERMINAL_CONSOLE_SYNC.md. */
describe('auth', () => {
  it('parses a verified session and rejects unknown roles', () => {
    const user = {
      id: 'ACC-1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'buyer',
      onboardingCompleted: true,
      promotionalCredit: 100,
      promotionalCreditGranted: 100,
      promotionalCreditWithdrawable: false,
      welcomeCreditGrantedAt: null,
      csrfToken: 'token',
    };
    expect(SessionResponse.parse({ user }).user?.role).toBe('buyer');
    expect(SessionResponse.parse({ user: null }).user).toBeNull();
    expect(SessionResponse.safeParse({ user: { ...user, role: 'broker' } }).success).toBe(false);
  });
});

describe('marketplace', () => {
  it('keeps the submission receipt contract', () => {
    const receipt = {
      receiptId: 'RCPT-0123456789ABCDEF',
      source: 'terminal',
      status: 'Received',
      receivedAt: '2026-10-18T08:00:00.000Z',
      updatedAt: '2026-10-18T08:00:00.000Z',
      revision: 1,
    };
    expect(MarketplaceReceipt.parse(receipt).revision).toBe(1);
    const rfq = OwnedRfq.parse({
      id: 'RFQ-0123456789ABCDEF',
      model: 'H100',
      status: 'Open',
      submission: receipt,
    });
    expect(rfq.quotes).toEqual([]);
    expect(WorkspaceResponse.parse({}).review.status).toBe('Not started');
  });
  it('drops invalid rows of public feeds instead of failing the whole feed', () => {
    const feed = CuratedRfqsResponse.parse({ rfqs: [{ bad: true }] });
    expect(feed.rfqs).toEqual([]);
    const settlements = SettlementsResponse.parse({
      rows: [{ id: 'ORD-1', model: 'H100', settledAt: '2026-10-01T00:00:00Z' }, 42],
    });
    expect(settlements.rows.map((r) => r.id)).toEqual(['ORD-1']);
  });
  it('keeps the Spot instance key and END contracts', () => {
    const keys = InstanceSshKeysResponse.parse({
      keys: [
        {
          publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA buyer@laptop',
          fingerprint: 'SHA256:jJNmOjNUU4OSP3i5MnmJyUj15vepmU1pYL0Ghj0FXAk',
          comment: 'buyer@laptop',
        },
      ],
      version: 2,
      installed: false,
    });
    expect(keys.keys[0]?.comment).toBe('buyer@laptop');
    const ended = InstanceEndResponse.parse({
      confirmed: true,
      instance: { id: 'rental-1', status: 'ended', term: 'Spot' },
    });
    expect(ended.instance.status).toBe('ended');
    expect(InstanceEndResponse.safeParse({ confirmed: false, instance: { id: 'x' } }).success).toBe(
      false,
    );
  });
  it('keeps the Spot purchase contract', () => {
    const request = {
      pricingVersion: 'duration-v1',
      offerId: 'spotbot-us-west-2-g6.xlarge',
      durationHours: 1.5,
      expectedPricing: {
        currency: 'USD',
        durationHours: 1.5,
        hourlyCents: 39,
        baseCents: 59,
        feeCents: 3,
        totalCents: 62,
      },
      sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA buyer@laptop',
      idempotencyKey: '7f0c1e9e-2b1d-4c55-9a43-0d6f6a1d2c11',
    };
    expect(SpotPurchaseRequest.parse(request).expectedPricing.totalCents).toBe(62);
    expect(SpotPurchaseRequest.safeParse({ ...request, pricingVersion: 'v0' }).success).toBe(false);
    const confirmed = SpotPurchaseResponse.parse({
      confirmed: true,
      offerId: request.offerId,
      orderId: '0b7c7a52-55b8-4f0e-8a37-6bb0d1f3c7d2',
      currency: 'USD',
      durationHours: 1.5,
      totalCents: 62,
    });
    expect(confirmed.orderId).toHaveLength(36);
  });
});

describe('billing', () => {
  it('parses the confirmed credit account and top-up requests from both views', () => {
    const account = BillingAccount.parse({
      confirmed: true,
      accountId: 'ACC-1',
      currency: 'USD',
      availableCredit: 150,
      paidCredit: 50,
      promotionalCredit: 100,
      requests: [
        {
          id: 'TOPUP-00000000-0000-0000-0000-000000000000',
          accountId: 'ACC-1',
          amount: 100,
          amountCents: 10000,
          method: 'paypal',
          status: 'Pending',
        },
      ],
    });
    expect(account.requests[0].status).toBe('Pending');
    expect(CreditTopup.parse({ id: 'TOPUP-x', status: 'Approved', email: 'a@b.c' }).email).toBe(
      'a@b.c',
    );
  });
});

describe('pricing', () => {
  it('parses collected price records and the ticker feed', () => {
    const record = PriceRecord.parse({
      recordId: 'aws:p5.48xlarge:us-east-1:Spot',
      provider: 'aws',
      gpuModel: 'H100',
      region: 'us-east-1',
      term: 'Spot',
      gpuCount: 8,
      perGpuHourly: 2.5,
    });
    expect(record.gpuCount).toBe(8);
    const ticker = TickerResponse.parse({ records: [{ gpuModel: 'H100', term: 'Spot' }, null] });
    expect(ticker.records).toHaveLength(1);
  });
});

describe('admin instances', () => {
  const instance = {
    id: 'f8dcd7d2-147e-48dc-89b1-18bd7f145499',
    tenantId: 'integration-partner',
    orderId: 'order-10001',
    rfqId: 'order-10001',
    model: 'L4',
    gpuCount: 1,
    term: 'Spot',
    region: 'us-west-2',
    zone: 'us-west-2c',
    instanceType: 'g6.2xlarge',
    instanceId: 'i-0123456789abcdef0',
    generation: 3,
    state: 'ACTIVE',
    lifecycle: 'Running',
    error: null,
    degraded: null,
    priceCeilingHourlyUsd: '0.95',
    estimatedCostUsd: '0.420000',
    budgetUsd: '3.00',
    createdAt: '2026-10-27T03:00:00+00:00',
    expiresAt: '2026-10-28T00:00:00+00:00',
    closedAt: null,
  };

  it('parses a page of allocations and rejects unknown lifecycles', () => {
    const page = AdminInstancesResponse.parse({
      instances: [instance],
      nextCursor: '50',
      asOf: '2026-10-27T03:01:00+00:00',
    });
    expect(page.instances[0]?.lifecycle).toBe('Running');
    expect(
      AdminInstancesResponse.safeParse({
        instances: [{ ...instance, lifecycle: 'Paused' }],
        nextCursor: null,
        asOf: 'x',
      }).success,
    ).toBe(false);
  });
});
