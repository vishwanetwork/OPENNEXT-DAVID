import { z } from 'zod';
import type { BankTransferIntent, BankTransferRequest } from '@/lib/buyer-kyb';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const intentSchema = z.object({
  confirmed: z.literal(true),
  accountId: z.string().min(1),
  demo: z.literal(false),
  id: identifier,
  purpose: z.enum(['topup', 'order']),
  currency: z.literal('USD'),
  amountCents: cents,
  reference: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 /._:-]{0,99}$/)
    .refine((value) => !value.includes('://')),
  expiresAt: z.string().datetime({ offset: true }),
});

export const transferRequestSchema = z
  .object({
    purpose: z.enum(['topup', 'order']),
    amountCents: cents,
    currency: z.literal('USD'),
    purchaseReference: z.string().max(160).optional(),
    orderId: identifier.optional(),
    offerId: identifier.optional(),
    durationHours: z
      .number()
      .positive()
      .refine(
        (value) =>
          Number.isSafeInteger(Math.round(value * 100)) &&
          Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
      )
      .optional(),
    sshPublicKey: z.string().max(16384).nullable().optional(),
    idempotencyKey: identifier,
  })
  .superRefine((request, context) => {
    if (
      request.purpose === 'order' &&
      !request.orderId &&
      !(request.offerId && request.durationHours)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An order or a capacity offer with a duration is required.',
      });
  });

/** Frontend receipt validation, not a replacement for backend pricing or KYB enforcement. */
export function confirmedTransferIntent(
  value: unknown,
  accountId: string,
  expected?: Pick<BankTransferRequest, 'purpose' | 'amountCents' | 'currency'>,
  now = Date.now(),
): BankTransferIntent | null {
  const parsed = intentSchema.safeParse(value);
  if (!parsed.success || !accountId) return null;
  const intent = parsed.data;
  if (intent.accountId !== accountId || Date.parse(intent.expiresAt) <= now) return null;
  if (
    expected &&
    (intent.purpose !== expected.purpose ||
      intent.amountCents !== expected.amountCents ||
      intent.currency !== expected.currency)
  )
    return null;
  return intent;
}

const reportSchema = z.object({
  confirmed: z.literal(true),
  intentId: identifier,
  status: z.literal('Awaiting payment confirmation'),
});

export function confirmedTransferReport(value: unknown, intentId: string) {
  const parsed = reportSchema.safeParse(value);
  return parsed.success && parsed.data.intentId === intentId ? parsed.data : null;
}

export type TransferReport = NonNullable<ReturnType<typeof confirmedTransferReport>>;
export interface TransferRecord {
  intent: BankTransferIntent;
  report?: TransferReport;
}
