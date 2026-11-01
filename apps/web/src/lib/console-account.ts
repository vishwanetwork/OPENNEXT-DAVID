/** Private read-only Console account service, enabled by the accounts-v1 capability. */
export interface ConsoleAccountSummary {
  userId: string;
  accountNumber: string | null;
  kybStatus: 'NotStarted' | 'Reviewing' | 'Approved' | 'Rejected' | null;
  currency: 'USD';
  currentCreditCents: number | null;
  bankAccountCount: number | null;
}

export interface ConsoleBankAccount {
  id: string;
  accountName: string;
  bankName: string;
  country: string;
  currency: string;
  maskedAccountNumber: string;
  maskedIban: string | null;
  swiftCode: string | null;
}

export interface ConsoleCreditEntry {
  id: string;
  kind: 'Top-up' | 'Purchase' | 'Refund' | 'Adjustment';
  amountCents: number;
  balanceAfterCents: number | null;
  reference: string | null;
  description: string;
  at: string;
}

export interface ConsolePurchaseEntry {
  id: string;
  kind: 'Instance' | 'RFQ';
  model: string;
  capacity: number;
  totalCents: number;
  currency: 'USD';
  status: string;
  purchasedAt: string;
}

export interface ConsoleAccountDetail {
  confirmed: true;
  demo: false;
  sessionScope: string;
  account: ConsoleAccountSummary;
  bankAccounts: ConsoleBankAccount[] | null;
  creditHistory: { entries: ConsoleCreditEntry[]; nextCursor: string | null } | null;
  purchaseHistory: { entries: ConsolePurchaseEntry[]; nextCursor: string | null } | null;
  asOf: string;
}

export interface ConsoleAccountService {
  /** Server-issued operator session, not the customer account or email. */
  readonly sessionScope: string;
  summaries(input: { userIds: string[]; signal: AbortSignal }): Promise<{
    confirmed: true;
    demo: false;
    sessionScope: string;
    accounts: ConsoleAccountSummary[];
    asOf: string;
  }>;
  details(input: {
    userId: string;
    creditCursor: string;
    purchaseCursor: string;
    signal: AbortSignal;
  }): Promise<ConsoleAccountDetail>;
}
