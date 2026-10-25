import { z } from 'zod';

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

/** Manual credit top-up request (`/api/billing/topups`, reviewed in the console). */
export const CreditTopup = z
  .object({
    id: z.string(),
    accountId: z.string(),
    ownerId: str,
    amount: z.number(),
    amountCents: z.number().optional(),
    currency: str,
    method: z.string(),
    status: z.enum(['Pending', 'Approved', 'Rejected']).or(z.string()),
    purchaseReference: str,
    reason: str,
    createdAt: str,
    reviewedAt: str,
  })
  .passthrough();
export type CreditTopup = z.infer<typeof CreditTopup>;

export const BillingNotification = z
  .object({ id: z.string(), ownerId: str, subject: str, message: str, created: str, createdAt: str, read: z.boolean().optional(), topupId: str })
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

export const TOPUP_METHODS = ['credit_card', 'paypal'] as const;
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
  .object({ id: z.string(), amount: z.number(), status: z.string(), destination: str, beneficiary: str, createdAt: str, paidAt: str, test: z.boolean().optional() })
  .passthrough();
export type Payout = z.infer<typeof Payout>;
