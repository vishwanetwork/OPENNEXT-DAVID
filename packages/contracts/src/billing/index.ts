import { z } from 'zod';
import { num, numberOrString, str } from '../_shared';

export const TOPUP_STATUSES = ['Pending', 'Approved', 'Rejected'] as const;
export type TopupStatus = (typeof TOPUP_STATUSES)[number];
export const TOPUP_METHODS = ['credit_card', 'paypal'] as const;

/**
 * Manual credit top-up request (`/api/billing/topups`; reviewed in the console at
 * `/api/admin/topups`, where `email`, `workspaceId` and `demo` are also present).
 */
export const CreditTopup = z
  .object({
    id: z.string(),
    accountId: str,
    ownerId: str,
    email: str,
    amount: numberOrString.nullish(),
    amountCents: z.number().nullish(),
    currency: str,
    method: str,
    /** One of TOPUP_STATUSES; unknown values are shown verbatim. */
    status: z.string(),
    purchaseReference: str,
    reason: str,
    solved: z.boolean().nullish(),
    createdAt: str,
    reviewedAt: str,
    workspaceId: str,
    demo: z.boolean().nullish(),
  })
  .passthrough();
export type CreditTopup = z.infer<typeof CreditTopup>;

export const BillingNotification = z
  .object({
    id: z.string(),
    ownerId: str,
    subject: str,
    message: str,
    created: str,
    createdAt: str,
    read: z.boolean().optional(),
    topupId: str,
  })
  .passthrough();

/** GET /api/billing/account — the verified credit account. Only `confirmed: true` snapshots may replace a balance. */
export const BillingAccount = z
  .object({
    confirmed: z.boolean(),
    accountId: z.string(),
    currency: z.string(),
    availableCredit: z.number(),
    paidCredit: z.number(),
    promotionalCredit: z.number(),
    requests: z.array(CreditTopup).default([]),
    notifications: z.array(BillingNotification).default([]),
    demo: z.boolean().optional(),
    scope: str,
  })
  .passthrough();
export type BillingAccount = z.infer<typeof BillingAccount>;

export const CreditTopupCreateRequest = z.object({
  amount: z.number().min(1).max(100000),
  method: z.enum(TOPUP_METHODS),
  idempotencyKey: z.string().uuid(),
  purchaseReference: z.string().optional(),
});
export type CreditTopupCreateRequest = z.infer<typeof CreditTopupCreateRequest>;
export const CreditTopupResponse = z.object({ request: CreditTopup }).passthrough();
export const CreditTopupGetResponse = CreditTopupResponse;

/** POST /api/billing/checkout — provider checkout; 503 PAYMENTS_NOT_CONFIGURED until connected. */
export const CheckoutRequest = z.object({
  amount: z.number().min(1).max(100000),
  method: z.enum(TOPUP_METHODS),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9-]{12,80}$/),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;
export const CheckoutResponse = z.object({ checkoutUrl: z.string().url() });
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;

/** Ledger entry (browser-side view of posted account activity). */
export const LedgerEntry = z
  .object({
    id: z.string(),
    orderId: str,
    type: str,
    amount: z.number(),
    date: str,
    createdAt: str,
    status: str,
    role: str,
    side: str,
    test: z.boolean().optional(),
    wallet: str,
    paymentId: str,
    paymentReference: str,
    paymentMethod: str,
    destination: str,
  })
  .passthrough();
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const Payout = z
  .object({
    id: z.string(),
    amount: z.number(),
    status: z.string(),
    destination: str,
    beneficiary: str,
    createdAt: str,
    paidAt: str,
    test: z.boolean().optional(),
  })
  .passthrough();
export type Payout = z.infer<typeof Payout>;

/* ---------- Spot purchase by Credit (contract expected by the terminal Spot market) ---------- */

/** Pricing the client computed and the backend must recompute independently before charging. */
export const SpotCheckoutPricing = z.object({
  currency: z.literal('USD'),
  durationHours: z.number().positive(),
  hourlyCents: z.number().int().positive(),
  baseCents: z.number().int().positive(),
  feeCents: z.number().int().nonnegative(),
  totalCents: z.number().int().positive(),
});
export type SpotCheckoutPricing = z.infer<typeof SpotCheckoutPricing>;

/** `beginPurchase` request. Idempotent on `idempotencyKey`; never falls back to metered billing. */
export const SpotPurchaseRequest = z.object({
  pricingVersion: z.literal('duration-v1'),
  offerId: z.string().min(1).max(160),
  durationHours: z.number().positive(),
  expectedPricing: SpotCheckoutPricing,
  sshPublicKey: z.string().max(16384).nullable(),
  idempotencyKey: z.string().min(12).max(100),
});
export type SpotPurchaseRequest = z.infer<typeof SpotPurchaseRequest>;

/** `beginPurchase` response: the client accepts only an exact confirmation of offer, duration and total. */
export const SpotPurchaseResponse = z.object({
  confirmed: z.literal(true),
  offerId: z.string(),
  orderId: z.string().min(1).max(200),
  currency: z.literal('USD'),
  durationHours: z.number(),
  totalCents: z.number().int(),
});
export type SpotPurchaseResponse = z.infer<typeof SpotPurchaseResponse>;

/** Verified available Credit (also satisfied by `GET /api/billing/account`). */
export const CreditBalance = z.object({
  confirmed: z.literal(true),
  accountId: z.string(),
  currency: z.literal('USD'),
  availableCredit: z.number().nonnegative(),
});
export type CreditBalance = z.infer<typeof CreditBalance>;
