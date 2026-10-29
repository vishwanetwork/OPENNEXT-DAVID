/** Frontend ports only. No existing top-up endpoint implements this review protocol. */
export type PaymentReviewKind = 'topup' | 'direct_pay';
export type PaymentReviewStatus = 'Pending' | 'Confirmed' | 'Failed';

export interface PaymentReviewRecord {
  id: string;
  accountId: string;
  email: string;
  revision: number;
  kind: PaymentReviewKind;
  status: PaymentReviewStatus;
  currency: 'USD';
  amountCents: number;
  reference: string;
  submittedAt: string;
  orderId?: string;
  /** Top-ups add the full received amount. Purchase fees belong to order totals only. */
  pricingVersion: 'credit-face-value-v1' | 'order-total-v1' | 'legacy-credit-v1';
  creditAmountCents?: number;
  feeAmountCents?: number;
}

export interface PaymentReviewDecision {
  caseId: string;
  accountId: string;
  expectedRevision: number;
  idempotencyKey: string;
  decision: 'Confirm' | 'Fail';
  fundsVerified: boolean;
  reason: string;
}

export interface PaymentReviewReceipt {
  confirmed: boolean;
  currency: 'USD';
  pricingVersion: PaymentReviewRecord['pricingVersion'];
  caseId: string;
  accountId: string;
  revision: number;
  idempotencyKey: string;
  status: 'Confirmed' | 'Failed';
  notificationQueued: boolean;
  emailQueued: boolean;
  amountCents: number;
  creditAmountCents: number;
  feeAmountCents: number;
  ledgerPosted: boolean;
  provisioningQueued: boolean;
}

export interface PaymentReviewService {
  /** Opaque, non-secret identity rotated on each operator session/permission change. */
  readonly sessionScope: string;
  list: (
    kind: PaymentReviewKind,
    signal?: AbortSignal,
  ) => Promise<{
    confirmed: boolean;
    sessionScope: string;
    records: PaymentReviewRecord[];
  }>;
  /** Backend owns bank verification, ledger/provisioning and notification/email outboxes. */
  decide: (input: PaymentReviewDecision) => Promise<PaymentReviewReceipt>;
}
