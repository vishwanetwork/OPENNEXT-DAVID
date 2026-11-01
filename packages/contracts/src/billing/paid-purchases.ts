import { z } from 'zod';

export const PaidPurchase = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  transferId: z.string().min(1),
  offerId: z.string().min(1),
  orderId: z.string().min(1),
  model: z.string(),
  gpuCount: z.number().int().nonnegative(),
  region: z.string(),
  durationHours: z.number().positive(),
  amountCents: z.number().int().nonnegative().safe(),
  currency: z.literal('USD'),
  state: z.enum(['awaiting_customer_order', 'redeeming', 'submitted', 'credited']),
  expiresAt: z.string().datetime({ offset: true }),
  rentalId: z.string().nullable(),
  capacityGuaranteed: z.literal(false),
});
export const PaidPurchasesResponse = z.object({
  confirmed: z.literal(true),
  demo: z.literal(false),
  accountId: z.string().min(1),
  purchases: z.array(PaidPurchase),
});
export const RedeemPaidPurchaseResponse = z.object({
  confirmed: z.literal(true),
  demo: z.literal(false),
  accountId: z.string().min(1),
  purchase: PaidPurchase,
});
