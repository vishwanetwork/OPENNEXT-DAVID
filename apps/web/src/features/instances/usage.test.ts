import { describe, expect, it } from 'vitest';
import type { Instance, Order } from '@opennext/contracts';
import { confirmedUsage, instanceCountry, instanceTitle, purchasedHours, usageBars } from './usage';
import { instanceUsageFixture } from '@/test/instance-usage-fixture';

const valid = () => ({
  ...instanceUsageFixture(),
  confirmed: true,
  demo: false,
  accountId: 'u1',
  instanceId: 'ins-1',
});
const instance: Instance = { id: 'ins-1', model: 'A10G', count: 1, region: 'us-west-2' };

describe('instance presentation', () => {
  it.each([
    ['us-west-2', 'USA'],
    ['US East', 'USA'],
    ['US', 'USA'],
    ['United States', 'USA'],
    ['eu-central-1', 'Germany'],
    ['ap-northeast-1', 'Japan'],
    ['ap-southeast-1', 'Singapore'],
    ['CA', 'Canada'],
    ['Canada Central', 'Canada'],
    ['unknown-zone-1', 'Country unavailable'],
  ])('normalizes %s to %s without exposing provider region codes', (region, country) => {
    expect(instanceCountry(region)).toBe(country);
  });
  it('uses an explicit country before region inference', () => {
    expect(instanceCountry('unknown-zone', 'DE')).toBe('Germany');
  });
  it('uses purchased duration, never elapsed time or expiry', () => {
    expect(purchasedHours({ ...instance, durationHours: 72 }, [])).toBe(72);
    expect(
      purchasedHours({ ...instance, orderId: 'order-1' }, [{ id: 'order-1', hours: 24 } as Order]),
    ).toBe(24);
    expect(
      purchasedHours(
        { ...instance, serviceStart: '2026-10-28T00:00:00Z', serviceEnd: '2026-10-31T00:00:00Z' },
        [],
      ),
    ).toBeNull();
    expect(instanceTitle(instance, 72)).toBe('1 × A10G - 72H - USA');
    expect(instanceTitle(instance, null)).toBe('1 × A10G - USA');
  });
});

describe('recorded instance usage', () => {
  it('accepts only confirmed records matching account, instance and environment', () => {
    expect(confirmedUsage(valid(), 'u1', 'ins-1', false)).not.toBeNull();
    expect(
      confirmedUsage(instanceUsageFixture(), 'illustration', 'INSTANCE-EXAMPLE', true),
    ).toBeNull();
    expect(confirmedUsage(valid(), 'other', 'ins-1', false)).toBeNull();
    expect(confirmedUsage(valid(), 'u1', 'other', false)).toBeNull();
    expect(confirmedUsage(valid(), 'u1', 'ins-1', true)).toBeNull();
  });
  it('rejects overlapping intervals, invalid telemetry and observations before the window', () => {
    const snapshot = valid();
    expect(
      confirmedUsage(
        { ...snapshot, intervals: [...snapshot.intervals, snapshot.intervals[0]] },
        'u1',
        'ins-1',
        false,
      ),
    ).toBeNull();
    expect(
      confirmedUsage(
        { ...snapshot, intervals: [{ ...snapshot.intervals[0], utilizationPercent: 101 }] },
        'u1',
        'ins-1',
        false,
      ),
    ).toBeNull();
    expect(
      confirmedUsage({ ...snapshot, observedAt: snapshot.windowStart }, 'u1', 'ins-1', false),
    ).toBeNull();
  });
  it('rejects inconsistent ledger totals and nonzero charges for zero billable time', () => {
    const snapshot = valid();
    const billing = snapshot.billing;
    if (!billing) throw new Error('Fixture ledger missing');
    expect(
      confirmedUsage({ ...snapshot, billing: { ...billing, totalCents: 1 } }, 'u1', 'ins-1', false),
    ).toBeNull();
    expect(
      confirmedUsage(
        {
          ...snapshot,
          billing: {
            ...billing,
            entries: billing.entries.map((entry) => ({ ...entry, billableSeconds: 0 })),
          },
        },
        'u1',
        'ins-1',
        false,
      ),
    ).toBeNull();
  });
  it('rejects billable time inside a recorded interruption and duplicate ledger periods', () => {
    const snapshot = valid();
    const billing = snapshot.billing;
    if (!billing) throw new Error('Fixture ledger missing');
    expect(
      confirmedUsage(
        {
          ...snapshot,
          billing: {
            ...billing,
            entries: billing.entries.map((entry, index) =>
              index === 3 ? { ...entry, billableSeconds: 3600 } : entry,
            ),
          },
        },
        'u1',
        'ins-1',
        false,
      ),
    ).toBeNull();
    const first = billing.entries[0];
    if (!first) throw new Error('Fixture entry missing');
    expect(
      confirmedUsage(
        {
          ...snapshot,
          billing: {
            ...billing,
            complete: false,
            entries: [first, { ...first, id: 'duplicate-period' }],
          },
        },
        'u1',
        'ins-1',
        false,
      ),
    ).toBeNull();
  });
  it('keeps interruption gaps and distinguishes unknown utilization from zero', () => {
    const snapshot = valid();
    const bars = usageBars(
      snapshot.intervals,
      Date.parse(snapshot.windowStart),
      Date.parse(snapshot.windowEnd),
      8,
    );
    expect(bars).toHaveLength(8);
    expect(bars[3]).toMatchObject({ connected: 0, interrupted: 1, utilization: null });
    expect(bars[4]?.connected).toBe(1);
    const first = snapshot.intervals[0];
    if (!first) throw new Error('Fixture interval missing');
    expect(
      usageBars(
        [{ ...first, utilizationPercent: null }],
        Date.parse(first.startedAt),
        Date.parse(first.endedAt),
        1,
      )[0],
    ).toMatchObject({ connected: 1, utilization: null });
    expect(
      usageBars(
        [{ ...first, utilizationPercent: 0 }],
        Date.parse(first.startedAt),
        Date.parse(first.endedAt),
        1,
      )[0]?.utilization,
    ).toBe(0);
    expect(usageBars([], 10, 9)).toEqual([]);
  });
});
