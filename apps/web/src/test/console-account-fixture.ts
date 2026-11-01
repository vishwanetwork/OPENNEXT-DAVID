import { vi } from 'vitest';
import type {
  ConsoleAccountDetail,
  ConsoleAccountService,
  ConsoleAccountSummary,
} from '@/lib/console-account';
import { jsonResponse, mockFetch } from '@/test/render';

export const asOf = '2026-11-01T06:00:00Z';
export const person = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.test',
  role: 'buyer',
  status: 'Active',
  company: null,
  joinedAt: asOf,
};
export const summary: ConsoleAccountSummary = {
  userId: person.id,
  accountNumber: 'ON-00421',
  kybStatus: 'Approved',
  currentCreditCents: 10000,
  currency: 'USD',
  bankAccountCount: 1,
};
export const detail: ConsoleAccountDetail = {
  confirmed: true,
  demo: false,
  sessionScope: 'operator-one',
  account: summary,
  asOf,
  bankAccounts: [
    {
      id: 'bank-1',
      accountName: 'Example Business',
      bankName: 'Customer Bank',
      country: 'Singapore',
      currency: 'USD',
      maskedAccountNumber: '•••• 1234',
      maskedIban: null,
      swiftCode: 'BANKSGXX',
    },
  ],
  creditHistory: {
    entries: [
      {
        id: 'credit-1',
        kind: 'Top-up',
        amountCents: 15000,
        balanceAfterCents: 15000,
        reference: 'TOP-1',
        description: 'Bank transfer received',
        at: asOf,
      },
      {
        id: 'credit-2',
        kind: 'Purchase',
        amountCents: -5000,
        balanceAfterCents: 10000,
        reference: 'ORDER-1',
        description: 'GPU capacity purchase',
        at: asOf,
      },
    ],
    nextCursor: null,
  },
  purchaseHistory: {
    entries: [
      {
        id: 'ORDER-1',
        kind: 'Instance',
        model: 'H100',
        capacity: 8,
        totalCents: 5000,
        currency: 'USD',
        status: 'Running',
        purchasedAt: asOf,
      },
    ],
    nextCursor: null,
  },
};
export function mockDirectory(scope = 'operator-one') {
  return mockFetch((path) =>
    jsonResponse(
      path.endsWith('/operations/session')
        ? { confirmed: true, sessionScope: scope }
        : {
            users: [person],
            totalUsers: 1,
            filteredTotal: 1,
            growth: { '7D': 1, '1M': 1, '3M': 1, '6M': 1, '1Y': 1 },
            nextCursor: null,
            asOf,
          },
    ),
  );
}
export function adapter(): ConsoleAccountService & {
  summaries: ReturnType<typeof vi.fn<ConsoleAccountService['summaries']>>;
  details: ReturnType<typeof vi.fn<ConsoleAccountService['details']>>;
} {
  return {
    sessionScope: 'operator-one',
    summaries: vi.fn<ConsoleAccountService['summaries']>().mockResolvedValue({
      confirmed: true,
      demo: false,
      sessionScope: 'operator-one',
      accounts: [summary],
      asOf,
    }),
    details: vi.fn<ConsoleAccountService['details']>().mockResolvedValue(detail),
  };
}
