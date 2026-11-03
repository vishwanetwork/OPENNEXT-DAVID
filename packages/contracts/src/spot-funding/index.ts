import { z } from 'zod';

export const SpotFundingCapabilities = z.object({
  confirmed: z.literal(true),
  accountId: z.string().min(1),
  demo: z.literal(false),
  pricingVersion: z.literal('spot-hourly-v1'),
  enabled: z.boolean(),
  readEnabled: z.boolean().optional(),
  required: z.boolean().optional(),
});

export const FloatingPaymentResolution = z.object({
  policy: z.literal('spot-hourly-v1'),
  fundingOrderId: z.string().min(1).max(200),
  orderId: z.string().min(1).max(200),
  outcome: z.enum(['funded', 'credited']),
});
export type FloatingPaymentResolution = z.infer<typeof FloatingPaymentResolution>;

const safeInteger = z
  .number()
  .finite()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const cents = safeInteger.nonnegative();
const seconds = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().trim().min(1).max(200);
const timestamp = z.string().datetime({ offset: true });
const warnings = z.enum(['remaining_20_percent', 'projected_shortfall', 'next_hour_unfunded']);

const position = z
  .object({
    cycleId: identifier,
    baselineCents: cents,
    remainingCents: cents,
    remainingPercent: z.number().finite().min(0).max(100).nullable(),
    nextHourRequiredCents: cents.nullable(),
    projectedRemainingCents: cents.nullable(),
    status: z.enum(['healthy', 'low', 'insufficient', 'unavailable']),
    warnings: z.array(warnings),
  })
  .superRefine((value, context) => {
    const invalid = () =>
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent funding position.' });
    if (
      value.remainingCents > value.baselineCents ||
      new Set(value.warnings).size !== value.warnings.length
    )
      invalid();
    if (value.baselineCents === 0) {
      if (value.remainingPercent !== null) invalid();
    } else if (
      value.remainingPercent === null ||
      Math.abs(value.remainingPercent - (value.remainingCents / value.baselineCents) * 100) > 0.011
    )
      invalid();
    const low = value.baselineCents > 0 && value.remainingCents / value.baselineCents <= 0.2;
    const unfunded =
      value.nextHourRequiredCents !== null && value.nextHourRequiredCents > value.remainingCents;
    const shortfall =
      value.projectedRemainingCents !== null &&
      value.projectedRemainingCents > value.remainingCents;
    if (value.warnings.includes('remaining_20_percent') && !low) invalid();
    if (value.warnings.includes('next_hour_unfunded') && !unfunded) invalid();
    if (value.warnings.includes('projected_shortfall') && !shortfall) invalid();
    if (value.status === 'healthy' && (value.warnings.length > 0 || unfunded)) invalid();
    if (value.status === 'insufficient' && !unfunded) invalid();
  });

const order = z
  .object({
    orderId: identifier,
    instanceId: identifier.nullable(),
    model: z.string().trim().min(1).max(200),
    paymentMethod: z.enum(['Credit', 'Direct Pay']),
    initialPaymentCents: cents.positive(),
    initialHourlyCents: cents.positive(),
    currentHourlyCents: cents.positive().nullable(),
    purchasedSeconds: seconds.positive(),
    remainingSeconds: seconds,
    runtimeState: z.enum([
      'waiting',
      'running',
      'reconnecting',
      'paused_insufficient_funds',
      'ended',
    ]),
    retention: z.enum(['confirmed', 'pending', 'unavailable']),
    storageReserveCents: cents.optional(),
    storageReserveTargetCents: cents.optional(),
    maxHourlyCents: cents.positive().optional(),
    maxTotalCents: cents.positive().optional(),
    totalFundedCents: cents.optional(),
    pauseReason: z
      .enum([
        'price_unavailable',
        'hourly_limit',
        'execution_review',
        'total_limit',
        'insufficient_funding',
      ])
      .nullable()
      .optional(),
    retentionExpiresAt: timestamp.nullable().optional(),
    funding: position,
  })
  .refine(
    (value) => value.remainingSeconds <= value.purchasedSeconds,
    'Remaining runtime exceeds purchased runtime.',
  );

const envelope = {
  confirmed: z.literal(true),
  pricingVersion: z.literal('spot-hourly-v1'),
  accountId: identifier,
  demo: z.boolean(),
  observedAt: timestamp,
  currency: z.literal('USD'),
};

export const FloatingSpotQuoteRequest = z
  .object({
    offerId: identifier,
    durationHours: z.number().min(1).max(720),
    paymentMethod: z.enum(['Credit', 'Direct Pay']),
    maxHourlyCents: cents.positive().max(10_000_000),
    maxTotalCents: cents.positive().max(10_000_000),
    inferencePresetId: z.string().max(100).nullable().optional(),
  })
  .strict();
export const FloatingSpotQuote = z.object({
  ...envelope,
  quoteId: identifier,
  offerId: identifier,
  expiresAt: timestamp,
  hourlyCents: cents.positive(),
  purchasedSeconds: seconds.positive(),
  paymentMethod: z.enum(['Credit', 'Direct Pay']),
  computeFundingCents: cents,
  storageReserveCents: cents,
  initialPaymentCents: cents.positive(),
  maxHourlyCents: cents.positive(),
  maxTotalCents: cents.positive(),
  storageRetentionSeconds: z.literal(604800),
  protectedGiB: cents.positive(),
  storageMonthlyUsd: z.string().min(1),
  serviceFeeCents: z.literal(0),
  inferencePresetId: z.string().nullable(),
});
export const FloatingSpotAcceptance = z
  .object({
    pricingVersion: z.literal('spot-hourly-v1'),
    quoteId: identifier,
    idempotencyKey: identifier,
    consent: z.literal(true),
    storageRetentionAcknowledged: z.literal(true),
    inferenceBillingAcknowledged: z.boolean(),
    sshPublicKey: z.string().max(4096).nullable(),
  })
  .strict();

export const FloatingSpotTransfer = z.object({
  confirmed: z.literal(true),
  accountId: identifier,
  demo: z.literal(false),
  id: identifier,
  purpose: z.literal('order'),
  currency: z.literal('USD'),
  amountCents: cents.positive(),
  idempotencyKey: identifier,
  reference: identifier,
  expiresAt: timestamp,
  status: z.string().min(1).max(100),
  orderId: identifier,
});
export const FloatingSpotPurchase = z.object({
  ...envelope,
  order,
  transfer: FloatingSpotTransfer.optional(),
});
export const FloatingSpotReplenishment = z
  .object({
    amountCents: cents.positive().max(10_000_000),
    idempotencyKey: identifier,
  })
  .strict();
export const FloatingSpotReplenished = z
  .object({
    ...envelope,
    order: order.optional(),
    transfer: FloatingSpotTransfer.optional(),
  })
  .refine(
    (value) => Boolean(value.order) !== Boolean(value.transfer),
    'One funding outcome is required.',
  );
export const SpotFundingAccountSchema = z.object({
  ...envelope,
  credit: position,
  activeCreditOrders: cents,
  orders: z.array(order),
  ordersComplete: z.boolean(),
});
const charge = z.object({
  id: identifier,
  entryKind: z.enum(['usage', 'adjustment']).optional(),
  startedAt: timestamp,
  endedAt: timestamp,
  billableSeconds: seconds,
  hourlyCents: cents.positive(),
  computeCents: cents,
  adjustmentCents: safeInteger,
  totalCents: cents,
  explanation: z.string().max(2000).nullable(),
});
export const SpotFundingOrderDetailSchema = z.object({
  ...envelope,
  order,
  ledger: z.object({
    totalCents: cents,
    entries: z.array(charge),
    nextCursor: z.string().min(1).max(2048).nullable(),
    complete: z.boolean(),
  }),
});
