import {
  OPENNEXT_COMPANY,
  SPOT_AGREEMENT_VERSION,
  type SignedSpotAgreement,
  type SpotAgreementContext,
  type SpotAgreementDocument,
} from '@/lib/spot-agreement';

export const agreementContextFixture = (): SpotAgreementContext => ({
  accountId: 'u1',
  purchaseReference: 'purchase-1',
  offerId: 'offer-1',
  offerFingerprint: 'offer-fingerprint-1',
  model: 'H100',
  gpuCount: 8,
  vcpu: 192,
  memoryGbPerGpu: 80,
  country: 'Singapore',
  paymentMethod: 'credit',
  pricing: {
    currency: 'USD',
    durationHours: 2,
    hourlyCents: 1440,
    baseCents: 2880,
    feeCents: 0,
    totalCents: 2880,
  },
});

export function agreementDocumentFixture(
  context: SpotAgreementContext = agreementContextFixture(),
  now = Date.now(),
): SpotAgreementDocument {
  return {
    confirmed: true,
    demo: false,
    id: 'agreement-1',
    version: SPOT_AGREEMENT_VERSION,
    documentHash: 'a'.repeat(64),
    context,
    accountNumber: 'ON-1001',
    kyb: {
      caseId: 'kyb-1',
      revision: 2,
      companyName: 'Example Limited',
      registrationNumber: '123456',
      country: 'GB',
      noticeEmail: 'billing@example.com',
    },
    provider: {
      legalName: OPENNEXT_COMPANY.legalName,
      registrationNumber: OPENNEXT_COMPANY.registrationNumber,
      representative: OPENNEXT_COMPANY.representative,
      address: OPENNEXT_COMPANY.address,
      noticeEmail: 'support@example.com',
      governingLaw: 'Test governing law',
      disputeForum: 'Test dispute forum',
    },
    policies: {
      approved: true,
      serviceWindow: 'cumulative-running-time',
      dataPreservationVerified: true,
      cashoutEnabled: true,
      minimumChargeRule: 'Test minimum billing policy',
      cashoutTerms: 'Test cashout policy',
      taxTreatment: 'Test tax policy',
      retentionAfterEnd: 'Test retention policy',
      settlementTiming: 'Test settlement policy',
      paymentCollectionAuthority: 'Test payment collection authority',
    },
    expiresAt: new Date(now + 3_600_000).toISOString(),
  };
}

export function signedAgreementFixture(
  context: SpotAgreementContext = agreementContextFixture(),
  now = Date.now(),
): SignedSpotAgreement {
  return {
    confirmed: true,
    demo: false,
    agreementId: 'agreement-1',
    version: SPOT_AGREEMENT_VERSION,
    documentHash: 'a'.repeat(64),
    signatureId: 'signature-1',
    context,
    kybCaseId: 'kyb-1',
    kybRevision: 2,
    signatoryName: 'Ada Lovelace',
    signatoryTitle: 'Director',
    signedAt: new Date(now).toISOString(),
    providerExecutedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    executionComplete: true,
  };
}
