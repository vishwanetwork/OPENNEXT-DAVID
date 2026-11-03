import { z } from 'zod';
import type {
  SpotFundingAccount,
  SpotFundingLookup,
  SpotFundingOrderDetail,
} from '@/lib/spot-funding';

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
const account = z.object({
  ...envelope,
  credit: position,
  activeCreditOrders: cents,
  orders: z.array(order),
  ordersComplete: z.boolean(),
});
const charge = z.object({
  id: identifier,
  startedAt: timestamp,
  endedAt: timestamp,
  billableSeconds: seconds,
  hourlyCents: cents.positive(),
  computeCents: cents,
  adjustmentCents: safeInteger,
  totalCents: cents,
  explanation: z.string().max(2000).nullable(),
});
const detail = z.object({
  ...envelope,
  order,
  ledger: z.object({
    totalCents: cents,
    entries: z.array(charge),
    nextCursor: z.string().min(1).max(2048).nullable(),
    complete: z.boolean(),
  }),
});

/** Validate server facts, not billing calculations or local warning decisions. */
export function confirmedSpotFundingAccount(
  value: unknown,
  accountId: string,
  demo: boolean,
): SpotFundingAccount | null {
  const parsed = account.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== accountId || parsed.data.demo !== demo)
    return null;
  const snapshot = parsed.data;
  if (new Set(snapshot.orders.map((item) => item.orderId)).size !== snapshot.orders.length)
    return null;
  const instanceIds = snapshot.orders.flatMap((item) => (item.instanceId ? [item.instanceId] : []));
  if (new Set(instanceIds).size !== instanceIds.length) return null;
  const active = snapshot.orders.filter(
    (item) => item.paymentMethod === 'Credit' && item.runtimeState !== 'ended',
  ).length;
  if (
    active > snapshot.activeCreditOrders ||
    (snapshot.ordersComplete && active !== snapshot.activeCreditOrders)
  )
    return null;
  return snapshot;
}

export function confirmedSpotFundingOrder(
  value: unknown,
  accountId: string,
  demo: boolean,
  lookup: SpotFundingLookup,
): SpotFundingOrderDetail | null {
  const parsed = detail.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== accountId || parsed.data.demo !== demo)
    return null;
  const snapshot = parsed.data;
  if (
    'orderId' in lookup
      ? snapshot.order.orderId !== lookup.orderId
      : snapshot.order.instanceId !== lookup.instanceId
  )
    return null;
  const { ledger } = snapshot;
  if (ledger.complete && ledger.nextCursor !== null) return null;
  if (new Set(ledger.entries.map((entry) => entry.id)).size !== ledger.entries.length) return null;
  let previousEnd = -Infinity;
  let total = 0;
  let billableSeconds = 0;
  for (const entry of [...ledger.entries].sort(
    (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt),
  )) {
    const start = Date.parse(entry.startedAt);
    const end = Date.parse(entry.endedAt);
    const elapsed = (end - start) / 1000;
    const amount = entry.computeCents + entry.adjustmentCents;
    total += entry.totalCents;
    billableSeconds += entry.billableSeconds;
    if (
      start < previousEnd ||
      elapsed <= 0 ||
      elapsed > 3600 ||
      end > Date.parse(snapshot.observedAt) ||
      entry.billableSeconds > elapsed
    )
      return null;
    if (
      !Number.isSafeInteger(amount) ||
      amount !== entry.totalCents ||
      !Number.isSafeInteger(total)
    )
      return null;
    if (entry.adjustmentCents !== 0 && !entry.explanation?.trim()) return null;
    previousEnd = end;
  }
  if (
    billableSeconds >
    snapshot.order.purchasedSeconds - snapshot.order.remainingSeconds + 0.000001
  )
    return null;
  if (total > ledger.totalCents || (ledger.complete && total !== ledger.totalCents)) return null;
  return snapshot;
}
