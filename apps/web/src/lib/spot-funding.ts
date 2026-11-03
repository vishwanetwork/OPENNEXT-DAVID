/**
 * Proposed read-only frontend port, not an approved wire contract.
 * The composition root must leave it undefined until the billing backend supports
 * hourly settlement, scoped funding reads and the required customer consent.
 */
export interface SpotFundingPosition {
  cycleId: string;
  baselineCents: number;
  remainingCents: number;
  remainingPercent: number | null;
  nextHourRequiredCents: number | null;
  projectedRemainingCents: number | null;
  status: 'healthy' | 'low' | 'insufficient' | 'unavailable';
  warnings: ('remaining_20_percent' | 'projected_shortfall' | 'next_hour_unfunded')[];
}

export type SpotRuntimeState =
  | 'waiting'
  | 'running'
  | 'reconnecting'
  | 'paused_insufficient_funds'
  | 'ended';

export interface SpotFundingOrder {
  orderId: string;
  instanceId: string | null;
  model: string;
  paymentMethod: 'Credit' | 'Direct Pay';
  initialPaymentCents: number;
  initialHourlyCents: number;
  currentHourlyCents: number | null;
  purchasedSeconds: number;
  remainingSeconds: number;
  runtimeState: SpotRuntimeState;
  storageReserveCents?: number;
  retentionExpiresAt?: string | null;
  retention: 'confirmed' | 'pending' | 'unavailable';
  funding: SpotFundingPosition;
}

export interface SpotFundingAccount {
  confirmed: true;
  pricingVersion: 'spot-hourly-v1';
  accountId: string;
  demo: boolean;
  observedAt: string;
  currency: 'USD';
  /** Server aggregate across every active Credit-funded order, not this page. */
  credit: SpotFundingPosition;
  activeCreditOrders: number;
  orders: SpotFundingOrder[];
  /** The summary list may be partial; the aggregate above must remain complete. */
  ordersComplete: boolean;
}

export interface SpotHourlyCharge {
  id: string;
  entryKind?: 'usage' | 'adjustment';
  startedAt: string;
  endedAt: string;
  billableSeconds: number;
  /** Whole-instance USD cents/hour, including the accepted markup policy. */
  hourlyCents: number;
  computeCents: number;
  adjustmentCents: number;
  totalCents: number;
  /** Preserves minimum/rounding explanations without deriving a unit rate. */
  explanation: string | null;
}

export interface SpotFundingOrderDetail {
  confirmed: true;
  pricingVersion: 'spot-hourly-v1';
  accountId: string;
  demo: boolean;
  observedAt: string;
  currency: 'USD';
  order: SpotFundingOrder;
  ledger: {
    totalCents: number;
    entries: SpotHourlyCharge[];
    nextCursor: string | null;
    complete: boolean;
  };
}

export type SpotFundingLookup = { orderId: string } | { instanceId: string };

export interface SpotFundingService {
  /** Opaque, non-secret adapter/session scope. Rotate after authorization changes. */
  scope: string;
  loadAccount: (input: { signal?: AbortSignal }) => Promise<unknown>;
  loadOrder: (
    input: SpotFundingLookup & { cursor?: string; signal?: AbortSignal },
  ) => Promise<unknown>;
}
