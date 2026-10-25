import { describe, expect, it } from 'vitest';
import {
  BillingAccount,
  CreditTopup,
  CuratedRfqsResponse,
  MarketplaceReceipt,
  OwnedRfq,
  PriceRecord,
  SessionResponse,
  SettlementsResponse,
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
