import type { InstanceUsageSnapshot } from '@/lib/instance-usage';

/** Test-only usage and ledger fixture. Never imported by application components. */
export function instanceUsageFixture(): InstanceUsageSnapshot {
  const start = Date.parse('2026-10-28T08:00:00Z');
  const time = (hours: number) => new Date(start + hours * 3_600_000).toISOString();
  return {
    confirmed: false,
    accountId: 'illustration',
    instanceId: 'INSTANCE-EXAMPLE',
    demo: true,
    observedAt: time(8),
    windowStart: time(0),
    windowEnd: time(8),
    purchasedHours: 48,
    retainedDataConfirmed: true,
    intervals: Array.from({ length: 16 }, (_, index) => ({
      startedAt: time(index / 2),
      endedAt: time((index + 1) / 2),
      state: index >= 6 && index < 8 ? ('interrupted' as const) : ('connected' as const),
      utilizationPercent:
        index >= 6 && index < 8
          ? null
          : ([42, 56, 72, 64, 84, 78, 0, 0, 45, 61, 79, 89, 72, 81, 66, 74][index] ?? 0),
    })),
    events: [
      {
        id: 'started',
        at: time(0),
        type: 'started',
        initiatedBy: 'platform',
        description: 'The purchased instance became available. Metered usage started.',
      },
      {
        id: 'interrupted',
        at: time(3),
        type: 'interrupted',
        initiatedBy: 'provider',
        description:
          'Spot capacity was interrupted by the provider. Billing paused while replacement capacity was located.',
      },
      {
        id: 'reconnected',
        at: time(4),
        type: 'reconnected',
        initiatedBy: 'platform',
        description:
          'A replacement with the same specifications was connected. Preserved data became available and billing resumed.',
      },
    ],
    billing: {
      currency: 'USD',
      startedAt: time(0),
      stoppedAt: null,
      totalCents: 13524,
      complete: true,
      entries: Array.from({ length: 8 }, (_, index) => ({
        id: `fixture-hour-${index}`,
        startedAt: time(index),
        endedAt: time(index + 1),
        billableSeconds: index === 3 ? 0 : 3600,
        computeCents: index === 3 ? 0 : 1840,
        feeCents: index === 3 ? 0 : 92,
        totalCents: index === 3 ? 0 : 1932,
      })),
    },
  };
}
