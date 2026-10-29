import { z } from 'zod';
import type {
  PaymentReviewDecision,
  PaymentReviewKind,
  PaymentReviewRecord,
  PaymentReviewService,
} from '@/lib/payment-review';

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const recordSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  email: z.string().email(),
  revision: z.number().int().positive(),
  kind: z.enum(['topup', 'direct_pay']),
  status: z.enum(['Pending', 'Confirmed', 'Failed']),
  currency: z.literal('USD'),
  amountCents: cents.positive(),
  reference: z.string().min(1),
  submittedAt: z.string().datetime({ offset: true }),
  orderId: z.string().min(1).optional(),
  pricingVersion: z.enum(['credit-face-value-v1', 'order-total-v1', 'legacy-credit-v1']),
  creditAmountCents: cents.optional(),
  feeAmountCents: cents.optional(),
});

export function reviewable(record: PaymentReviewRecord) {
  if (record.status !== 'Pending') return false;
  if (record.kind === 'direct_pay')
    return record.pricingVersion === 'order-total-v1' && Boolean(record.orderId);
  return (
    record.pricingVersion === 'credit-face-value-v1' &&
    Number.isSafeInteger(record.amountCents) &&
    record.amountCents > 0 &&
    record.creditAmountCents === record.amountCents &&
    record.feeAmountCents === 0
  );
}

export function confirmedPaymentRecords(
  value: Awaited<ReturnType<PaymentReviewService['list']>>,
  kind: PaymentReviewKind,
  scope: string,
) {
  const parsed = z
    .object({
      confirmed: z.literal(true),
      sessionScope: z.literal(scope),
      records: z.array(recordSchema),
    })
    .safeParse(value);
  if (
    !parsed.success ||
    parsed.data.records.some((row) => row.kind !== kind) ||
    new Set(parsed.data.records.map((row) => row.id)).size !== parsed.data.records.length
  )
    throw new Error('The private payment queue could not be verified. Refresh before reviewing.');
  return parsed.data.records;
}

export function confirmedPaymentDecision(
  value: Awaited<ReturnType<PaymentReviewService['decide']>>,
  record: PaymentReviewRecord,
  input: PaymentReviewDecision,
) {
  if (
    !value ||
    value.confirmed !== true ||
    value.currency !== record.currency ||
    value.pricingVersion !== record.pricingVersion ||
    value.caseId !== record.id ||
    value.accountId !== record.accountId ||
    value.revision !== record.revision + 1 ||
    value.idempotencyKey !== input.idempotencyKey ||
    value.status !== (input.decision === 'Confirm' ? 'Confirmed' : 'Failed') ||
    value.notificationQueued !== true ||
    value.emailQueued !== true ||
    value.amountCents !== record.amountCents
  )
    return false;
  if (input.decision === 'Fail')
    return (
      value.creditAmountCents === 0 &&
      value.feeAmountCents === 0 &&
      value.ledgerPosted === false &&
      value.provisioningQueued === false
    );
  if (record.kind === 'topup')
    return (
      reviewable(record) &&
      value.creditAmountCents === record.creditAmountCents &&
      value.feeAmountCents === record.feeAmountCents &&
      value.ledgerPosted === true &&
      value.provisioningQueued === false
    );
  return (
    reviewable(record) &&
    value.creditAmountCents === 0 &&
    value.feeAmountCents === 0 &&
    value.ledgerPosted === false &&
    value.provisioningQueued === true
  );
}
