import { SpotFundingAccountSchema, SpotFundingOrderDetailSchema } from '@opennext/contracts';
import type {
  SpotFundingAccount,
  SpotFundingLookup,
  SpotFundingOrderDetail,
} from '@/lib/spot-funding';

/** Validate server facts, not billing calculations or local warning decisions. */
export function confirmedSpotFundingAccount(
  value: unknown,
  accountId: string,
  demo: boolean,
): SpotFundingAccount | null {
  const parsed = SpotFundingAccountSchema.safeParse(value);
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
  const parsed = SpotFundingOrderDetailSchema.safeParse(value);
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
      (entry.entryKind === 'adjustment'
        ? elapsed !== 0 || entry.billableSeconds !== 0 || !entry.explanation?.trim()
        : elapsed <= 0) ||
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
