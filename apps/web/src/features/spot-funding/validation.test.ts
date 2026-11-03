import { describe, expect, it } from 'vitest';
import type {
  SpotFundingAccount,
  SpotFundingOrder,
  SpotFundingOrderDetail,
  SpotFundingPosition,
} from '@/lib/spot-funding';
import { confirmedSpotFundingAccount, confirmedSpotFundingOrder } from './validation';

const position = (): SpotFundingPosition => ({
  cycleId: 'cycle-1',
  baselineCents: 10000,
  remainingCents: 2000,
  remainingPercent: 20,
  nextHourRequiredCents: 1200,
  projectedRemainingCents: 4800,
  status: 'low',
  warnings: ['remaining_20_percent', 'projected_shortfall'],
});
const order = (): SpotFundingOrder => ({
  orderId: 'order-1',
  instanceId: 'instance-1',
  model: 'H100',
  paymentMethod: 'Credit',
  initialPaymentCents: 10000,
  initialHourlyCents: 1000,
  currentHourlyCents: 1200,
  purchasedSeconds: 36000,
  remainingSeconds: 28800,
  runtimeState: 'running',
  retention: 'confirmed',
  funding: position(),
});
const envelope = {
  confirmed: true as const,
  pricingVersion: 'spot-hourly-v1' as const,
  accountId: 'u1',
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD' as const,
};
const account = (): SpotFundingAccount => ({
  ...envelope,
  credit: position(),
  activeCreditOrders: 1,
  orders: [order()],
  ordersComplete: true,
});
const detail = (): SpotFundingOrderDetail => ({
  ...envelope,
  order: order(),
  ledger: {
    totalCents: 2200,
    complete: true,
    nextCursor: null,
    entries: [
      {
        id: 'charge-1',
        startedAt: '2026-11-03T10:00:00Z',
        endedAt: '2026-11-03T11:00:00Z',
        billableSeconds: 3600,
        hourlyCents: 1000,
        computeCents: 1000,
        adjustmentCents: 0,
        totalCents: 1000,
        explanation: null,
      },
      {
        id: 'charge-2',
        startedAt: '2026-11-03T11:00:00Z',
        endedAt: '2026-11-03T12:00:00Z',
        billableSeconds: 3600,
        hourlyCents: 1200,
        computeCents: 1200,
        adjustmentCents: 0,
        totalCents: 1200,
        explanation: null,
      },
    ],
  },
});
const readAccount = (value: unknown) => confirmedSpotFundingAccount(value, 'u1', false);
const readOrder = (value: unknown) =>
  confirmedSpotFundingOrder(value, 'u1', false, { orderId: 'order-1' });

describe('floating Spot funding validation', () => {
  it('preserves the server low-funding forecast and actual changing hourly rates', () => {
    expect(readAccount(account())?.credit.warnings).toEqual([
      'remaining_20_percent',
      'projected_shortfall',
    ]);
    expect(readOrder(detail())?.ledger.entries.map((entry) => entry.hourlyCents)).toEqual([
      1000, 1200,
    ]);
  });
  it.each([
    { accountId: 'other' },
    { demo: true },
    { confirmed: false },
    { currency: 'EUR' },
    { pricingVersion: 'duration-v1' },
    { observedAt: 'invalid' },
  ])('rejects an invalid response envelope %j', (changes) => {
    expect(readAccount({ ...account(), ...changes })).toBeNull();
    expect(readOrder({ ...detail(), ...changes })).toBeNull();
  });
  it('checks both order and instance lookups', () => {
    expect(
      confirmedSpotFundingOrder(detail(), 'u1', false, { instanceId: 'instance-1' }),
    ).not.toBeNull();
    expect(confirmedSpotFundingOrder(detail(), 'u1', false, { instanceId: 'other' })).toBeNull();
    expect(confirmedSpotFundingOrder(detail(), 'u1', false, { orderId: 'other' })).toBeNull();
  });
  it.each([-1, 1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid money %s',
    (amount) => {
      const value = account();
      value.credit.remainingCents = amount;
      expect(readAccount(value)).toBeNull();
    },
  );
  it('rejects contradictory ratios, warnings and aggregate counts', () => {
    for (const changes of [
      { remainingPercent: 80 },
      { remainingCents: 11000 },
      { warnings: ['next_hour_unfunded'] },
      { warnings: ['remaining_20_percent', 'remaining_20_percent'] },
      { status: 'healthy' },
      { status: 'insufficient' },
    ])
      expect(readAccount({ ...account(), credit: { ...position(), ...changes } })).toBeNull();
    expect(readAccount({ ...account(), activeCreditOrders: 0 })).toBeNull();
    expect(readAccount({ ...account(), activeCreditOrders: 2 })).toBeNull();
    expect(
      readAccount({ ...account(), activeCreditOrders: 2, ordersComplete: false }),
    ).not.toBeNull();
  });
  it('accepts an empty account baseline without pretending it has a percentage', () => {
    const value = account();
    value.credit = {
      ...position(),
      baselineCents: 0,
      remainingCents: 0,
      remainingPercent: null,
      nextHourRequiredCents: null,
      projectedRemainingCents: null,
      status: 'unavailable',
      warnings: [],
    };
    value.orders = [];
    value.activeCreditOrders = 0;
    expect(readAccount(value)).not.toBeNull();
  });
  it('accepts the server pause state only with consistent next-hour funding facts', () => {
    const value = detail();
    value.order.runtimeState = 'paused_insufficient_funds';
    value.order.funding = {
      ...position(),
      remainingCents: 900,
      remainingPercent: 9,
      status: 'insufficient',
      warnings: ['remaining_20_percent', 'next_hour_unfunded'],
    };
    expect(readOrder(value)?.order.runtimeState).toBe('paused_insufficient_funds');
    value.order.funding.nextHourRequiredCents = 500;
    expect(readOrder(value)).toBeNull();
  });
  it('rejects duplicate orders and instance bindings', () => {
    const value = account();
    value.orders.push(order());
    value.activeCreditOrders = 2;
    expect(readAccount(value)).toBeNull();
    value.orders[1] = { ...order(), orderId: 'order-2' };
    expect(readAccount(value)).toBeNull();
  });
  it('rejects impossible remaining runtime and ledger runtime', () => {
    expect(readOrder({ ...detail(), order: { ...order(), remainingSeconds: 36001 } })).toBeNull();
    expect(readOrder({ ...detail(), order: { ...order(), remainingSeconds: 35999 } })).toBeNull();
  });
  it('rejects duplicate, overlapping, future and overlong ledger periods', () => {
    const base = detail();
    const first = base.ledger.entries[0];
    const last = base.ledger.entries[1];
    if (!first || !last) throw new Error('Missing test entries.');
    for (const changes of [
      { id: first.id },
      { startedAt: '2026-11-03T10:30:00Z' },
      { endedAt: '2026-11-03T12:30:00Z' },
      { billableSeconds: 3601 },
      { endedAt: last.startedAt },
    ])
      expect(
        readOrder({
          ...base,
          ledger: { ...base.ledger, entries: [first, { ...last, ...changes }] },
        }),
      ).toBeNull();
  });
  it('requires exact safe totals and distinguishes a partial ledger', () => {
    const value = detail();
    expect(readOrder({ ...value, ledger: { ...value.ledger, totalCents: 2201 } })).toBeNull();
    expect(
      readOrder({
        ...value,
        ledger: { ...value.ledger, totalCents: 2201, complete: false, nextCursor: 'older' },
      }),
    ).not.toBeNull();
    expect(readOrder({ ...value, ledger: { ...value.ledger, nextCursor: 'older' } })).toBeNull();
    const first = value.ledger.entries[0];
    if (!first) throw new Error('Missing test entry.');
    expect(
      readOrder({
        ...value,
        ledger: {
          ...value.ledger,
          entries: [
            {
              ...first,
              computeCents: Number.MAX_SAFE_INTEGER,
              adjustmentCents: 1,
              totalCents: Number.MAX_SAFE_INTEGER,
            },
          ],
        },
      }),
    ).toBeNull();
  });
  it('preserves signed, explained minimum and rounding adjustments without recomputing charges', () => {
    const value = detail();
    const first = value.ledger.entries[0];
    if (!first) throw new Error('Missing test entry.');
    value.ledger = {
      totalCents: 999,
      nextCursor: null,
      complete: true,
      entries: [
        { ...first, adjustmentCents: -1, totalCents: 999, explanation: 'Rounding adjustment.' },
      ],
    };
    expect(readOrder(value)?.ledger.entries[0]?.hourlyCents).toBe(1000);
    value.ledger.entries[0] = {
      ...first,
      billableSeconds: 30,
      computeCents: 9,
      adjustmentCents: 990,
      totalCents: 999,
      explanation: 'Order minimum adjustment.',
    };
    expect(readOrder(value)).not.toBeNull();
    value.ledger.entries[0] = { ...value.ledger.entries[0], explanation: null };
    expect(readOrder(value)).toBeNull();
  });
});
