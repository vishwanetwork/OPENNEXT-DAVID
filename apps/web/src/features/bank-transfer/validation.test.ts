import { describe, expect, it } from 'vitest';
import {
  confirmedTransferIntent,
  confirmedTransferReport,
  transferRequestSchema,
} from './validation';

const intent = {
  confirmed: true,
  accountId: 'u1',
  demo: false,
  id: 'transfer-1',
  purpose: 'topup',
  currency: 'USD',
  amountCents: 10000,
  reference: 'ONX-100',
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('bank transfer receipt validation', () => {
  it('accepts only the confirmed matching owner, amount and purpose', () => {
    const expected = { purpose: 'topup' as const, currency: 'USD' as const, amountCents: 10000 };
    expect(confirmedTransferIntent(intent, 'u1', expected)).toEqual(intent);
    expect(confirmedTransferIntent(intent, 'other', expected)).toBeNull();
    expect(confirmedTransferIntent(intent, 'u1', { ...expected, amountCents: 1 })).toBeNull();
    expect(confirmedTransferIntent(intent, 'u1', { ...expected, purpose: 'order' })).toBeNull();
  });
  it.each([
    { confirmed: false },
    { demo: true },
    { currency: 'EUR' },
    { amountCents: 0 },
    { amountCents: 10.5 },
    { id: '' },
    { reference: 'https://not-a-payment.example' },
    { expiresAt: '2000-01-01T00:00:00Z' },
    { expiresAt: 'invalid' },
  ])('rejects an unsafe instruction payload %j', (change) => {
    expect(confirmedTransferIntent({ ...intent, ...change }, 'u1')).toBeNull();
  });
  it('rejects incomplete requests before calling the adapter', () => {
    expect(
      transferRequestSchema.safeParse({ purpose: 'topup', amountCents: 1, currency: 'USD' })
        .success,
    ).toBe(false);
    expect(
      transferRequestSchema.safeParse({
        purpose: 'topup',
        amountCents: 1,
        currency: 'USD',
        idempotencyKey: 'request-1',
      }).success,
    ).toBe(true);
  });
  it('requires an order reference or a priced offer and accepts hundredth-hour duration', () => {
    const request = {
      purpose: 'order',
      amountCents: 10000,
      currency: 'USD',
      idempotencyKey: 'order-1',
    };
    expect(transferRequestSchema.safeParse(request).success).toBe(false);
    expect(
      transferRequestSchema.safeParse({ ...request, offerId: 'offer-1', durationHours: 1.25 })
        .success,
    ).toBe(true);
    expect(
      transferRequestSchema.safeParse({ ...request, offerId: 'offer-1', durationHours: 1.255 })
        .success,
    ).toBe(false);
    expect(transferRequestSchema.safeParse({ ...request, orderId: 'order-1' }).success).toBe(true);
  });
  it('a report receipt must not claim paid or change the selected intent', () => {
    const receipt = {
      confirmed: true,
      intentId: 'transfer-1',
      status: 'Awaiting payment confirmation',
    };
    expect(confirmedTransferReport(receipt, 'transfer-1')).toEqual(receipt);
    expect(confirmedTransferReport(receipt, 'other')).toBeNull();
    expect(confirmedTransferReport({ ...receipt, status: 'Paid' }, 'transfer-1')).toBeNull();
    expect(confirmedTransferReport({ ...receipt, confirmed: false }, 'transfer-1')).toBeNull();
  });
});
