import { vi } from 'vitest';
import type { CashoutAdminService, CashoutBankDetails, CashoutRecord } from '@/lib/cashout';
import type { CashoutCompletionInput } from './validation';

export const record: CashoutRecord = {
  id: 'CASH-1',
  accountId: 'buyer-1',
  accountNumber: 'ON-1001',
  email: 'buyer@example.com',
  amountCents: 10000,
  currency: 'USD',
  status: 'pending',
  revision: 1,
  kybId: 'KYB-1',
  kybRevision: 2,
  companyName: 'Example Limited',
  registrationNumber: 'REG-1',
  companyCountry: 'SG',
  bankName: 'Example Bank',
  bankCountry: 'SG',
  maskedAccount: '••••6789',
  submittedAt: '2026-11-01T03:00:00Z',
  idempotencyKey: 'submission-1',
};
export const bank: CashoutBankDetails = {
  beneficiaryName: 'Example Limited',
  beneficiaryAddress: '1 Example Road',
  bankName: 'Example Bank',
  bankCountry: 'SG',
  bankAddress: '2 Example Road',
  accountNumber: '123456789',
  iban: '',
  swiftBic: 'EXAMSGSG',
  routingCode: '',
  intermediaryBank: '',
  intermediarySwiftBic: '',
};
export const completion = (input: CashoutCompletionInput) => ({
  confirmed: true,
  requestId: record.id,
  accountId: record.accountId,
  revision: 2,
  status: 'completed' as const,
  amountCents: record.amountCents,
  currency: 'USD' as const,
  transferReference: input.transferReference,
  idempotencyKey: input.idempotencyKey,
  reservationSettled: true,
  notificationQueued: true,
  emailQueued: true,
});
export function adapter() {
  return {
    sessionScope: 'operator-a',
    list: vi.fn<CashoutAdminService['list']>().mockResolvedValue({
      confirmed: true,
      sessionScope: 'operator-a',
      requests: [record],
    }),
    details: vi.fn<NonNullable<CashoutAdminService['details']>>().mockResolvedValue({
      confirmed: true,
      sessionScope: 'operator-a',
      requestId: record.id,
      accountId: record.accountId,
      revision: record.revision,
      bank,
    }),
    complete: vi
      .fn<NonNullable<CashoutAdminService['complete']>>()
      .mockImplementation(async (input) => completion(input)),
  };
}
