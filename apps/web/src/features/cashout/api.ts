import { z } from 'zod';
import type { CashoutService, CashoutSubmission } from '@/lib/cashout';
import { cashoutRecordSchema, confirmedCashoutSnapshot } from './validation';

const receiptSchema = z.object({
  confirmed: z.literal(true),
  accountId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  reservedAmountCents: z.number().int().positive(),
  balanceRevision: z.number().int().nonnegative(),
  request: cashoutRecordSchema,
});

/** Validates capability results. There is deliberately no fabricated endpoint or live adapter. */
export const cashoutApi = {
  async load(service: CashoutService, accountId: string, signal?: AbortSignal) {
    const snapshot = confirmedCashoutSnapshot(await service.load(signal), accountId);
    if (!snapshot) throw new Error('Cashout information could not be verified for this account.');
    return snapshot;
  },
  async submit(service: CashoutService, input: CashoutSubmission) {
    const parsed = receiptSchema.safeParse(await service.submit(input));
    if (!parsed.success)
      throw new Error('Cashout submission was not confirmed. Check its status before retrying.');
    const result = parsed.data;
    const record = result.request;
    if (
      result.accountId !== input.accountId ||
      result.idempotencyKey !== input.idempotencyKey ||
      result.reservedAmountCents !== input.amountCents ||
      result.balanceRevision <= input.expectedBalanceRevision ||
      record.accountId !== input.accountId ||
      record.idempotencyKey !== input.idempotencyKey ||
      record.amountCents !== input.amountCents ||
      record.kybId !== input.kybId ||
      record.kybRevision !== input.expectedKybRevision ||
      record.companyName !== input.companyName ||
      record.registrationNumber !== input.registrationNumber ||
      record.companyCountry !== input.companyCountry ||
      record.bankName !== input.bank.bankName ||
      record.bankCountry !== input.bank.bankCountry ||
      record.status !== 'pending'
    )
      throw new Error(
        'Cashout submission was not confirmed for these details. Check its status before retrying.',
      );
    return result;
  },
};
