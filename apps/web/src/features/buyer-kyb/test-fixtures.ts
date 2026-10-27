import type { BuyerKybService, BuyerKybSnapshot, BuyerKybStatus } from '@/lib/buyer-kyb';
import { DOCUMENT_KINDS, emptyCompany } from './requirements';

export const companyFixture = () => ({
  ...emptyCompany(),
  country: 'SG',
  companyName: 'Example Pte Ltd',
  registrationNumber: '202601234A',
  email: 'billing@example.com',
  taxId: '202601234A',
  monthlyVolumeUsd: '5000',
  monthlyTransactions: '4',
  businessDescription: 'AI compute research',
});

export function snapshotFixture(status: BuyerKybStatus | null = null): BuyerKybSnapshot {
  return {
    confirmed: true,
    accountId: 'u1',
    demo: false,
    verification: status
      ? {
          id: 'kyb-1',
          accountId: 'u1',
          email: 'ada@example.com',
          mode: 'Auto',
          status,
          revision: 1,
          company: companyFixture(),
          submittedAt: '2026-10-27T06:00:00Z',
          documents: DOCUMENT_KINDS.map((kind) => ({
            id: kind,
            kind,
            fileName: `${kind}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 12,
          })),
        }
      : null,
  };
}

export const serviceFixture = (status: BuyerKybStatus | null = null): BuyerKybService => ({
  load: async () => snapshotFixture(status),
  submit: async () => snapshotFixture('Reviewing'),
});
