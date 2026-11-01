import { z } from 'zod';
import type { ConsoleAccountDetail, ConsoleAccountSummary } from '@/lib/console-account';

const id = z.string().trim().min(1);
const cents = z.number().int().safe();
const count = z.number().int().nonnegative().safe();
const timestamp = z.string().datetime({ offset: true });
const Summary = z.object({
  userId: id,
  accountNumber: id.nullable(),
  kybStatus: z.enum(['NotStarted', 'Reviewing', 'Approved', 'Rejected']).nullable(),
  currency: z.literal('USD'),
  currentCreditCents: cents.nullable(),
  bankAccountCount: count.nullable(),
});
const envelope = {
  confirmed: z.literal(true),
  demo: z.literal(false),
  sessionScope: id,
  asOf: timestamp,
};
const SummaryResponse = z.object({ ...envelope, accounts: z.array(Summary) });
const DetailResponse = z.object({
  ...envelope,
  account: Summary,
  bankAccounts: z
    .array(
      z.object({
        id,
        accountName: z.string(),
        bankName: z.string(),
        country: z.string(),
        currency: z.string(),
        maskedAccountNumber: z.string(),
        maskedIban: z.string().nullable(),
        swiftCode: z.string().nullable(),
      }),
    )
    .nullable(),
  creditHistory: z
    .object({
      entries: z.array(
        z.object({
          id,
          kind: z.enum(['Top-up', 'Purchase', 'Refund', 'Adjustment']),
          amountCents: cents,
          balanceAfterCents: cents.nullable(),
          reference: z.string().nullable(),
          description: z.string(),
          at: timestamp,
        }),
      ),
      nextCursor: id.nullable(),
    })
    .nullable(),
  purchaseHistory: z
    .object({
      entries: z.array(
        z.object({
          id,
          kind: z.enum(['Instance', 'RFQ']),
          model: z.string(),
          capacity: count,
          totalCents: count,
          currency: z.literal('USD'),
          status: z.string(),
          purchasedAt: timestamp,
        }),
      ),
      nextCursor: id.nullable(),
    })
    .nullable(),
});

export function confirmedSummaries(
  raw: unknown,
  scope: string,
  userIds: string[],
): ConsoleAccountSummary[] {
  const result = SummaryResponse.parse(raw);
  const allowed = new Set(userIds);
  const returned = new Set(result.accounts.map((account) => account.userId));
  if (
    result.sessionScope !== scope ||
    returned.size !== result.accounts.length ||
    result.accounts.some((account) => !allowed.has(account.userId))
  )
    throw new Error(
      'The account response does not match this operator session and user selection.',
    );
  return result.accounts;
}

export function confirmedDetail(raw: unknown, scope: string, userId: string): ConsoleAccountDetail {
  const result = DetailResponse.parse(raw);
  if (result.sessionScope !== scope || result.account.userId !== userId)
    throw new Error('The account details do not match this operator session and selected user.');
  return result;
}
