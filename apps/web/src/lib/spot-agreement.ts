import type { BankTransferIntent, BankTransferRequest } from './buyer-kyb';

export const SPOT_AGREEMENT_VERSION = 'opennext-spot-runtime-v2';
export const OPENNEXT_COMPANY = {
  brand: 'OpenNEXT',
  legalName: 'Bitfintech Group Limited',
  registrationNumber: '2180739',
  representative: 'Mrs. Shuxian Deng',
  address:
    'Start Chambers, Wickham’s Cay II, P.O. Box 2221, RoadTown, Tortola, British Virgin Islands',
} as const;

export type AgreementPaymentMethod = 'credit' | 'bank_transfer';
export interface AgreementPricing {
  currency: 'USD';
  durationHours: number;
  hourlyCents: number;
  baseCents: number;
  feeCents: number;
  totalCents: number;
}
export interface SpotAgreementContext {
  accountId: string;
  purchaseReference: string;
  offerId: string;
  offerFingerprint: string;
  model: string;
  gpuCount: number;
  vcpu: number | null;
  memoryGbPerGpu: number | null;
  country: string;
  paymentMethod: AgreementPaymentMethod;
  pricing: AgreementPricing;
}
export interface SpotAgreementDocument {
  confirmed: true;
  demo: false;
  id: string;
  version: typeof SPOT_AGREEMENT_VERSION;
  documentHash: string;
  context: SpotAgreementContext;
  accountNumber: string;
  kyb: {
    caseId: string;
    revision: number;
    companyName: string;
    registrationNumber: string;
    country: string;
    noticeEmail: string;
  };
  provider: {
    legalName: string;
    registrationNumber: string;
    representative: string;
    address: string;
    noticeEmail: string;
    governingLaw: string;
    disputeForum: string;
  };
  /** Operator-approved terms, frozen by the backend before signing. */
  policies: {
    approved: true;
    serviceWindow: 'cumulative-running-time';
    dataPreservationVerified: true;
    cashoutEnabled: true;
    minimumChargeRule: string;
    taxTreatment: string;
    retentionAfterEnd: string;
    settlementTiming: string;
    paymentCollectionAuthority: string;
    cashoutTerms: string;
  };
  expiresAt: string;
}
export interface SignedSpotAgreement {
  confirmed: true;
  demo: false;
  agreementId: string;
  version: typeof SPOT_AGREEMENT_VERSION;
  documentHash: string;
  signatureId: string;
  context: SpotAgreementContext;
  kybCaseId: string;
  kybRevision: number;
  signatoryName: string;
  signatoryTitle: string;
  signedAt: string;
  providerExecutedAt: string;
  expiresAt: string;
  executionComplete: true;
}
export interface AgreementPurchaseInput {
  pricingVersion: 'duration-v1';
  offerId: string;
  durationHours: number;
  expectedPricing: AgreementPricing;
  sshPublicKey: string | null;
  idempotencyKey: string;
}

/** Optional ports, not invented HTTP endpoints. All monetary enforcement remains server-side. */
export interface SpotAgreementService {
  prepare: (context: SpotAgreementContext, signal?: AbortSignal) => Promise<SpotAgreementDocument>;
  sign: (input: {
    agreementId: string;
    documentHash: string;
    kybRevision: number;
    signatoryName: string;
    signatoryTitle: string;
    authorityConfirmed: true;
    termsAccepted: true;
    interruptionAccepted: true;
    idempotencyKey: string;
  }) => Promise<SignedSpotAgreement>;
  purchaseByCredit: (input: {
    agreement: SignedSpotAgreement;
    purchase: AgreementPurchaseInput;
  }) => Promise<{
    confirmed: true;
    agreementId: string;
    offerId: string;
    orderId: string;
    currency: 'USD';
    durationHours: number;
    totalCents: number;
  }>;
  createBankTransfer: (input: {
    agreement: SignedSpotAgreement;
    request: BankTransferRequest;
  }) => Promise<BankTransferIntent & { agreementId: string }>;
  download: (input: { agreementId: string; documentHash: string }) => Promise<{
    agreementId: string;
    documentHash: string;
    fileName: string;
    blob: Blob;
  }>;
}
