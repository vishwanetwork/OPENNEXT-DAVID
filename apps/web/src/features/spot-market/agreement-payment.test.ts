import { describe, expect, it, vi } from 'vitest';
import type { BankTransferRequest } from '@/lib/buyer-kyb';
import type { SpotAgreementService } from '@/lib/spot-agreement';
import { signedAgreementFixture } from '@/test/spot-agreement-fixture';
import {
  PaymentNotStartedError,
  purchaseWithAgreement,
  transferWithAgreement,
} from './agreement-payment';
import type { PurchaseInput } from './checkout';

function adapter() {
  return {
    prepare: vi.fn<SpotAgreementService['prepare']>(),
    sign: vi.fn<SpotAgreementService['sign']>(),
    purchaseByCredit: vi
      .fn<SpotAgreementService['purchaseByCredit']>()
      .mockImplementation(async ({ agreement, purchase }) => ({
        confirmed: true,
        agreementId: agreement.agreementId,
        offerId: purchase.offerId,
        orderId: 'order-1',
        currency: 'USD',
        durationHours: purchase.durationHours,
        totalCents: purchase.expectedPricing.totalCents,
      })),
    createBankTransfer: vi
      .fn<SpotAgreementService['createBankTransfer']>()
      .mockImplementation(async ({ agreement, request }) => ({
        ...request,
        confirmed: true,
        demo: false,
        id: 'intent-1',
        accountId: agreement.context.accountId,
        agreementId: agreement.agreementId,
        reference: 'BANK-1',
        expiresAt: '2099-01-01T00:00:00Z',
      })),
    download: vi.fn<SpotAgreementService['download']>(),
  };
}

const agreement = signedAgreementFixture();
const purchase: PurchaseInput = {
  pricingVersion: 'duration-v1',
  offerId: agreement.context.offerId,
  durationHours: agreement.context.pricing.durationHours,
  expectedPricing: agreement.context.pricing,
  sshPublicKey: null,
  idempotencyKey: agreement.context.purchaseReference,
  agreement,
};
const request: BankTransferRequest = {
  purpose: 'order',
  amountCents: agreement.context.pricing.totalCents,
  currency: 'USD',
  offerId: agreement.context.offerId,
  durationHours: agreement.context.pricing.durationHours,
  purchaseReference: agreement.context.purchaseReference,
  idempotencyKey: agreement.context.purchaseReference,
};

describe('agreement-linked monetary transport', () => {
  it('fails closed when the service or signed receipt is absent', async () => {
    await expect(purchaseWithAgreement(undefined, purchase)).rejects.toBeInstanceOf(
      PaymentNotStartedError,
    );
    const service = adapter();
    await expect(
      purchaseWithAgreement(service, { ...purchase, agreement: undefined }),
    ).rejects.toThrow('not connected');
    expect(service.purchaseByCredit).not.toHaveBeenCalled();
    await expect(transferWithAgreement(undefined, agreement, request)).rejects.toThrow(
      'not connected',
    );
  });
  it('marks expired or mismatched local validation as not started, without dispatch', async () => {
    const service = adapter();
    const expired = { ...agreement, expiresAt: new Date(Date.now() - 1000).toISOString() };
    await expect(
      purchaseWithAgreement(service, { ...purchase, agreement: expired }),
    ).rejects.toBeInstanceOf(PaymentNotStartedError);
    await expect(
      purchaseWithAgreement(service, { ...purchase, offerId: 'other' }),
    ).rejects.toBeInstanceOf(PaymentNotStartedError);
    await expect(
      purchaseWithAgreement(service, { ...purchase, durationHours: 100 }),
    ).rejects.toBeInstanceOf(PaymentNotStartedError);
    await expect(transferWithAgreement(service, expired, request)).rejects.toBeInstanceOf(
      PaymentNotStartedError,
    );
    expect(service.purchaseByCredit).not.toHaveBeenCalled();
    expect(service.createBankTransfer).not.toHaveBeenCalled();
  });
  it('does not relabel transport failures or mismatched receipts as local preflight refusals', async () => {
    const service = adapter();
    const failure = new Error('The payment connection was interrupted.');
    service.purchaseByCredit.mockRejectedValueOnce(failure);
    await expect(purchaseWithAgreement(service, purchase)).rejects.toBe(failure);
    service.purchaseByCredit.mockResolvedValue({
      confirmed: true,
      agreementId: 'other',
      offerId: purchase.offerId,
      orderId: 'order-1',
      currency: 'USD',
      durationHours: purchase.durationHours,
      totalCents: purchase.expectedPricing.totalCents,
    });
    await expect(purchaseWithAgreement(service, purchase)).rejects.not.toBeInstanceOf(
      PaymentNotStartedError,
    );
    const signed = signedAgreementFixture({ ...agreement.context, paymentMethod: 'bank_transfer' });
    service.createBankTransfer.mockRejectedValueOnce(failure);
    await expect(transferWithAgreement(service, signed, request)).rejects.toBe(failure);
  });
  it('sends the exact agreement and purchase to the bound capability', async () => {
    const service = adapter();
    const result = await purchaseWithAgreement(service, purchase);
    expect(result.agreementId).toBe(agreement.agreementId);
    const { agreement: signed, ...input } = purchase;
    expect(service.purchaseByCredit).toHaveBeenCalledWith({ agreement: signed, purchase: input });
  });
  it('rejects a Credit confirmation belonging to a different agreement', async () => {
    const service = adapter();
    service.purchaseByCredit.mockResolvedValue({
      confirmed: true,
      agreementId: 'other',
      offerId: purchase.offerId,
      orderId: 'order-1',
      currency: 'USD',
      durationHours: purchase.durationHours,
      totalCents: purchase.expectedPricing.totalCents,
    });
    await expect(purchaseWithAgreement(service, purchase)).rejects.toThrow('did not match');
  });
  it('binds bank instructions to the same signed agreement and rejects mismatched instructions', async () => {
    const service = adapter();
    const signed = signedAgreementFixture({ ...agreement.context, paymentMethod: 'bank_transfer' });
    const result = await transferWithAgreement(service, signed, request);
    expect(service.createBankTransfer).toHaveBeenCalledWith({ agreement: signed, request });
    service.createBankTransfer.mockResolvedValue({ ...result, agreementId: 'other' });
    await expect(transferWithAgreement(service, signed, request)).rejects.toThrow('did not match');
  });
  it('rejects altered monetary context before calling either payment capability', async () => {
    const service = adapter();
    await expect(
      purchaseWithAgreement(service, { ...purchase, offerId: 'other' }),
    ).rejects.toThrow();
    await expect(
      purchaseWithAgreement(service, { ...purchase, durationHours: 100 }),
    ).rejects.toThrow();
    await expect(
      purchaseWithAgreement(service, {
        ...purchase,
        expectedPricing: { ...purchase.expectedPricing, totalCents: 1 },
      }),
    ).rejects.toThrow();
    expect(service.purchaseByCredit).not.toHaveBeenCalled();
    await expect(transferWithAgreement(service, agreement, request)).rejects.toThrow(
      'does not match',
    );
    const signed = signedAgreementFixture({ ...agreement.context, paymentMethod: 'bank_transfer' });
    for (const change of [
      { amountCents: 1 },
      { offerId: 'other' },
      { durationHours: 100 },
      { purchaseReference: 'other' },
      { idempotencyKey: 'other' },
    ])
      await expect(
        transferWithAgreement(service, signed, { ...request, ...change }),
      ).rejects.toThrow('does not match');
    expect(service.createBankTransfer).not.toHaveBeenCalled();
  });
});
