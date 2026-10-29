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
  pricingVersion: 'credit-face-value-v1' as const,
  creditAmountCents: 10000,
  feeAmountCents: 0,
  idempotencyKey: 'topup-2',
  reference: 'ONX-100',
  expiresAt: '2099-01-01T00:00:00Z',
};

describe('bank transfer receipt validation', () => {
  it('requires an exact face-value top-up receipt and rejects omitted or changed pricing', () => {
    const pricing = {
      pricingVersion: 'credit-face-value-v1' as const,
      creditAmountCents: 10000,
      feeAmountCents: 0,
      amountCents: 10000,
    };
    const expected = {
      purpose: 'topup' as const,
      currency: 'USD' as const,
      idempotencyKey: 'topup-2',
      ...pricing,
    };
    expect(confirmedTransferIntent({ ...intent, ...pricing }, 'u1', expected)).toMatchObject(
      pricing,
    );
    expect(confirmedTransferIntent({ ...intent, amountCents: 10500 }, 'u1', expected)).toBeNull();
    expect(
      confirmedTransferIntent({ ...intent, ...pricing, creditAmountCents: 10500 }, 'u1', expected),
    ).toBeNull();
    expect(
      transferRequestSchema.safeParse({ ...expected, idempotencyKey: 'topup-2' }).success,
    ).toBe(true);
    expect(
      transferRequestSchema.safeParse({
        ...expected,
        feeAmountCents: 500,
        idempotencyKey: 'topup-2',
      }).success,
    ).toBe(false);
    expect(
      transferRequestSchema.safeParse({
        ...expected,
        purpose: 'order',
        orderId: 'order-1',
        idempotencyKey: 'topup-2',
      }).success,
    ).toBe(false);
  });
  it('accepts only the confirmed matching owner, amount and purpose', () => {
    const expected = {
      purpose: 'topup' as const,
      currency: 'USD' as const,
      amountCents: 10000,
      idempotencyKey: 'topup-2',
    };
    expect(confirmedTransferIntent(intent, 'u1', expected)).toEqual(intent);
    expect(confirmedTransferIntent(intent, 'other', expected)).toBeNull();
    expect(confirmedTransferIntent(intent, 'u1', { ...expected, amountCents: 1 })).toBeNull();
    expect(confirmedTransferIntent(intent, 'u1', { ...expected, purpose: 'order' })).toBeNull();
  });
  it('rejects amount-only top-ups even without an expected request', () => {
    const amountOnly = {
      ...intent,
      pricingVersion: undefined,
      creditAmountCents: undefined,
      feeAmountCents: undefined,
    };
    expect(confirmedTransferIntent(amountOnly, 'u1')).toBeNull();
    expect(
      transferRequestSchema.safeParse({
        purpose: 'topup',
        currency: 'USD',
        amountCents: 10000,
        idempotencyKey: 'new-topup',
      }).success,
    ).toBe(false);
  });
  it('binds Direct Pay receipts to the exact request and selected capacity', () => {
    const expected = {
      purpose: 'order' as const,
      currency: 'USD' as const,
      amountCents: 10500,
      idempotencyKey: 'order-request-1',
      offerId: 'offer-1',
      durationHours: 72,
      purchaseReference: 'pending-1',
    };
    const receipt = {
      confirmed: true,
      accountId: 'u1',
      demo: false,
      id: 'transfer-order-1',
      reference: 'ONX-ORDER-1',
      expiresAt: intent.expiresAt,
      ...expected,
    };
    expect(confirmedTransferIntent(receipt, 'u1', expected)).toEqual(receipt);
    for (const change of [
      { idempotencyKey: 'other-request' },
      { offerId: 'offer-2' },
      { durationHours: 24 },
      { purchaseReference: 'pending-2' },
      { orderId: 'unexpected-order' },
    ]) {
      expect(confirmedTransferIntent({ ...receipt, ...change }, 'u1', expected)).toBeNull();
    }
    expect(
      confirmedTransferIntent({ ...receipt, idempotencyKey: undefined }, 'u1', expected),
    ).toBeNull();
    expect(
      confirmedTransferIntent({ ...receipt, offerId: undefined, durationHours: undefined }, 'u1'),
    ).toBeNull();
  });
  it('binds invoice orders and top-up return references without accepting another order', () => {
    const expected = {
      purpose: 'order' as const,
      currency: 'USD' as const,
      amountCents: 10500,
      idempotencyKey: 'invoice-request-1',
      orderId: 'invoice-1',
    };
    const receipt = {
      confirmed: true,
      accountId: 'u1',
      demo: false,
      id: 'transfer-invoice-1',
      reference: 'ONX-INVOICE-1',
      expiresAt: intent.expiresAt,
      ...expected,
    };
    expect(confirmedTransferIntent(receipt, 'u1', expected)).not.toBeNull();
    expect(
      confirmedTransferIntent({ ...receipt, orderId: 'invoice-2' }, 'u1', expected),
    ).toBeNull();
    expect(
      confirmedTransferIntent({ ...intent, purchaseReference: 'wrong-purchase' }, 'u1', {
        purpose: 'topup',
        currency: 'USD',
        amountCents: 10000,
        idempotencyKey: 'topup-2',
        purchaseReference: 'pending-1',
      }),
    ).toBeNull();
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
    ).toBe(false);
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
