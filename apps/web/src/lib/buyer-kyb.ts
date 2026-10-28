/** Frontend service ports only. No backend wire contract or live adapter is implemented here. */
export type BuyerKybMode = 'Auto' | 'Full';
export type BuyerKybStatus = 'Reviewing' | 'Approved' | 'Rejected';
export type BuyerKybReturn = 'topup' | 'spot' | 'billing';
export type KybDocumentKind =
  | 'legal-presence'
  | 'ownership-structure'
  | 'proof-of-address'
  | 'company-details'
  | 'representative-authorization';

export interface BuyerKybCompany {
  country: string;
  companyName: string;
  registrationNumber: string;
  email: string;
  website: string;
  taxId: string;
  monthlyVolumeUsd: string;
  monthlyTransactions: string;
  businessDescription: string;
  incorporationDate: string;
  legalForm: string;
  legalAddress: string;
  phone: string;
}

export interface BuyerKybDocument {
  id: string;
  kind: KybDocumentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface BuyerKybCase {
  id: string;
  accountId: string;
  email: string;
  mode: BuyerKybMode;
  status: BuyerKybStatus;
  revision: number;
  company: BuyerKybCompany;
  documents: BuyerKybDocument[];
  submittedAt: string;
  reviewedAt?: string;
  /** Rejection reasons are delivered privately through notifications, not general page fields. */
}

export interface BuyerKybSnapshot {
  confirmed: boolean;
  accountId: string;
  demo: boolean;
  verification: BuyerKybCase | null;
}

export interface BuyerKybService {
  load: (signal?: AbortSignal) => Promise<BuyerKybSnapshot>;
  /** Adapter must upload to private scanned storage, then atomically create the case. */
  submit: (input: {
    company: BuyerKybCompany;
    mode: BuyerKybMode;
    documents: { kind: KybDocumentKind; file: File }[];
    consent: true;
    idempotencyKey: string;
  }) => Promise<BuyerKybSnapshot>;
}

export interface BuyerKybAdminService {
  /** Opaque non-secret value that changes for every authenticated operator session. */
  readonly sessionScope: string;
  list: (signal?: AbortSignal) => Promise<{ confirmed: boolean; cases: BuyerKybCase[] }>;
  download: (input: {
    caseId: string;
    documentId: string;
    expectedRevision: number;
  }) => Promise<{ caseId: string; documentId: string; fileName: string; blob: Blob }>;
  decide: (input: {
    caseId: string;
    expectedRevision: number;
    decision: 'Approved' | 'Rejected';
    reason: string;
    allscaleApproved: boolean;
    idempotencyKey: string;
  }) => Promise<{
    confirmed: boolean;
    caseId: string;
    status: BuyerKybStatus;
    revision: number;
    notificationQueued: boolean;
  }>;
}

export interface BankTransferRequest {
  purpose: 'topup' | 'order';
  amountCents: number;
  currency: 'USD';
  purchaseReference?: string;
  orderId?: string;
  offerId?: string;
  durationHours?: number;
  sshPublicKey?: string | null;
  idempotencyKey: string;
}

export interface BankTransferIntent {
  confirmed: boolean;
  accountId: string;
  demo: boolean;
  id: string;
  purpose: 'topup' | 'order';
  currency: 'USD';
  amountCents: number;
  reference: string;
  expiresAt: string;
}

export interface BankTransferService {
  /** Server rechecks KYB, ownership, inventory and pricing before issuing instructions. */
  create: (request: BankTransferRequest) => Promise<BankTransferIntent>;
  reportSent: (input: { intentId: string; idempotencyKey: string }) => Promise<{
    confirmed: boolean;
    intentId: string;
    status: 'Awaiting payment confirmation';
  }>;
}
