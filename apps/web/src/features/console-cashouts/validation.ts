import { z } from 'zod';
import type { CashoutAdminService, CashoutRecord } from '@/lib/cashout';

const text = z.string().trim().min(1);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cents = revision.positive();
const date = z.string().datetime({ offset: true });
const recordSchema = z.object({
  id: text,
  accountId: text,
  accountNumber: text,
  email: z.string().email(),
  amountCents: cents,
  currency: z.literal('USD'),
  status: z.enum(['pending', 'completed', 'failed']),
  revision,
  kybId: text,
  kybRevision: revision,
  companyName: text,
  registrationNumber: text,
  companyCountry: text,
  bankName: text,
  bankCountry: text,
  maskedAccount: text.refine(
    (value) => /\*|[xX]{3}|•/.test(value),
    'A masked account is required.',
  ),
  submittedAt: date,
  completedAt: date.optional(),
  transferReference: text.optional(),
  idempotencyKey: text,
});

export function verifiedCashouts(value: unknown, scope: string): CashoutRecord[] {
  const result = z
    .object({
      confirmed: z.literal(true),
      sessionScope: z.literal(scope),
      requests: z.array(recordSchema),
    })
    .safeParse(value);
  if (
    !scope.trim() ||
    !result.success ||
    new Set(result.data.requests.map((row) => row.id)).size !== result.data.requests.length
  )
    throw new Error('The private cashout queue could not be verified. Refresh before reviewing.');
  return result.data.requests;
}

const bankSchema = z.object({
  beneficiaryName: text,
  beneficiaryAddress: text,
  bankName: text,
  bankCountry: text,
  bankAddress: text,
  accountNumber: z.string(),
  iban: z.string(),
  swiftBic: text,
  routingCode: z.string(),
  intermediaryBank: z.string(),
  intermediarySwiftBic: z.string(),
});

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export function verifiedCashoutDetails(value: unknown, record: CashoutRecord, scope: string) {
  const result = z
    .object({
      confirmed: z.literal(true),
      sessionScope: z.literal(scope),
      requestId: z.literal(record.id),
      accountId: z.literal(record.accountId),
      revision: z.literal(record.revision),
      bank: bankSchema,
    })
    .safeParse(value);
  if (
    !result.success ||
    !scope.trim() ||
    normalize(result.data.bank.beneficiaryName) !== normalize(record.companyName) ||
    normalize(result.data.bank.bankName) !== normalize(record.bankName) ||
    result.data.bank.bankCountry !== record.bankCountry ||
    (!result.data.bank.accountNumber.trim() && !result.data.bank.iban.trim())
  )
    throw new Error('Bank details could not be matched to this verified company and request.');
  return result.data.bank;
}

export type CashoutCompletionInput = Parameters<NonNullable<CashoutAdminService['complete']>>[0];

/** Stable across dialog reopen and network retries; the backend binds it to the first payload. */
export const cashoutCompletionKey = (record: CashoutRecord) =>
  `cashout-complete:${encodeURIComponent(record.id)}:${record.revision}`;

export function verifiedCashoutCompletion(
  value: unknown,
  record: CashoutRecord,
  input: CashoutCompletionInput,
) {
  return (
    record.status === 'pending' &&
    input.requestId === record.id &&
    input.accountId === record.accountId &&
    input.expectedRevision === record.revision &&
    input.transferReference.trim().length > 0 &&
    z
      .object({
        confirmed: z.literal(true),
        requestId: z.literal(record.id),
        accountId: z.literal(record.accountId),
        revision: z.literal(record.revision + 1),
        status: z.literal('completed'),
        amountCents: z.literal(record.amountCents),
        currency: z.literal('USD'),
        transferReference: z.literal(input.transferReference),
        idempotencyKey: z.literal(input.idempotencyKey),
        reservationSettled: z.literal(true),
        notificationQueued: z.literal(true),
        emailQueued: z.literal(true),
      })
      .safeParse(value).success
  );
}
