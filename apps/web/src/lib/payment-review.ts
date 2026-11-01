/** Operator-facing ports. New account and Direct Pay completion fields need backend agreement. */
export type PaymentReviewKind = 'topup' | 'direct_pay';
export type PaymentReviewStatus = 'Pending' | 'Confirmed' | 'Failed';

export interface PaymentReviewRecord {
  id: string;
  accountId: string;
  /** Assigned by the account service; never derived from an opaque user ID. */
  accountNumber?: string;
  currentCreditCents?: number;
  email: string;
  revision: number;
  kind: PaymentReviewKind;
  status: PaymentReviewStatus;
  currency: 'USD';
  amountCents: number;
  reference: string;
  submittedAt: string;
  orderId?: string;
  offerId?: string;
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
  directPayResolution?: {
    policy: 'recheck-before-purchase-v1';
    orderId: string;
    offerId: string;
    availabilityCheckedAt: string;
    outcome: 'awaiting_customer_order' | 'credited';
    /** Owner-bound paid intent, redeemable once without taking a second payment. */
    purchaseIntentId?: string;
  };
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
  /**
   * Opt-in only after backend rollout. Recheck the exact original offer, then retain a paid
   * purchase intent or credit the full received amount. Never call the old provisioning decision.
   */
  completeDirectPay?: (input: PaymentReviewDecision) => Promise<PaymentReviewReceipt>;
}
