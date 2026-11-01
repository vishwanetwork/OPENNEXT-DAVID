import { vi } from 'vitest';
import type {
  PaymentReviewDecision,
  PaymentReviewReceipt,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';

export type { PaymentReviewReceipt } from '@/lib/payment-review';

export const topup: PaymentReviewRecord = {
  id: 'PAY-1',
  accountId: 'buyer-1',
  accountNumber: 'ON-1001',
  currentCreditCents: 2500,
  email: 'buyer@example.com',
  revision: 1,
  kind: 'topup',
  status: 'Pending',
  currency: 'USD',
  amountCents: 10000,
  creditAmountCents: 10000,
  feeAmountCents: 0,
  reference: 'REF-1',
  submittedAt: '2026-10-29T01:00:00Z',
  pricingVersion: 'credit-face-value-v1',
};
export const direct: PaymentReviewRecord = {
  ...topup,
  kind: 'direct_pay',
  orderId: 'ORDER-1',
  offerId: 'OFFER-1',
  pricingVersion: 'order-total-v1',
  creditAmountCents: undefined,
  feeAmountCents: undefined,
};
export const input: PaymentReviewDecision = {
  caseId: topup.id,
  accountId: topup.accountId,
  expectedRevision: 1,
  idempotencyKey: 'decision-1',
  decision: 'Confirm',
  fundsVerified: true,
  reason: '',
};
export function receipt(
  row: PaymentReviewRecord,
  request: PaymentReviewDecision,
): PaymentReviewReceipt {
  return {
    confirmed: true,
    currency: row.currency,
    pricingVersion: row.pricingVersion,
    caseId: row.id,
    accountId: row.accountId,
    revision: row.revision + 1,
    idempotencyKey: request.idempotencyKey,
    status: request.decision === 'Fail' ? 'Failed' : 'Confirmed',
    notificationQueued: true,
    emailQueued: true,
    amountCents: row.amountCents,
    creditAmountCents:
      request.decision === 'Confirm' && row.kind === 'topup' ? (row.creditAmountCents ?? 0) : 0,
    feeAmountCents:
      request.decision === 'Confirm' && row.kind === 'topup' ? (row.feeAmountCents ?? 0) : 0,
    ledgerPosted: request.decision === 'Confirm' && row.kind === 'topup',
    provisioningQueued: false,
    ...(request.decision === 'Confirm' && row.kind === 'direct_pay'
      ? {
          directPayResolution: {
            policy: 'recheck-before-purchase-v1' as const,
            orderId: row.orderId ?? '',
            offerId: row.offerId ?? '',
            availabilityCheckedAt: '2026-10-29T02:00:00Z',
            outcome: 'awaiting_customer_order' as const,
            purchaseIntentId: 'PAID-1',
          },
        }
      : {}),
  };
}
export function adapter(row = topup) {
  return {
    completeDirectPay: vi
      .fn<NonNullable<PaymentReviewService['completeDirectPay']>>()
      .mockImplementation(async (request) => receipt(row, request)),
    sessionScope: 'operator-a',
    list: vi
      .fn<PaymentReviewService['list']>()
      .mockResolvedValue({ confirmed: true, sessionScope: 'operator-a', records: [row] }),
    decide: vi
      .fn<PaymentReviewService['decide']>()
      .mockImplementation(async (request) => receipt(row, request)),
  };
}
