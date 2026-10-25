import { z } from 'zod';

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
