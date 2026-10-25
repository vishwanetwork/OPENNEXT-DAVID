import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SHOW_OPTIONS,
  bandLabel,
  buildDemoSettlements,
  latestMatching,
  normalizeSettlement,
  priceBands,
  recentWindow,
  synchronizeTradeModel,
  type Settlement,
} from './settlements';

const raw = (overrides: Record<string, unknown> = {}) => ({
  id: 'ORDER-TEST',
  model: 'H100 SXM',
  country: 'Singapore',
  term: 'Spot',
  gpuCount: 8,
  vcpu: 192,
  memory: 80,
  perGpuHourly: 2.31,
  settledAt: new Date(Date.now() - 3600000).toISOString(),
  status: 'Completed',
  ...overrides,
});

describe('settlements', () => {
  it('normalization excludes quotes, references, invalid values and non-integer GPU counts', () => {
    expect(normalizeSettlement(raw(), 0)!.priceCents).toBe(231);
    for (const patch of [
      { status: 'Quoted' },
      { referenceOnly: true },
      { external: true },
      { perGpuHourly: Infinity },
      { gpuCount: Infinity },
      { gpuCount: 1.5 },
      { perGpuHourly: -1 },
      { gpuCount: 0 },
      { settledAt: 'bad' },
    ])
      expect(normalizeSettlement(raw(patch), 0), JSON.stringify(patch)).toBeNull();
    expect(
      JSON.stringify(normalizeSettlement(raw({ provider: 'Private Supplier' }), 0)),
    ).not.toContain('Private Supplier');
  });
  it('seven day window includes the boundary and excludes older/future rows', () => {
    const now = Date.now();
    const rows = [0, 1, 7 * 86400000, 7 * 86400000 + 1, -1000].map((age, i) => ({
      ...normalizeSettlement(raw({ id: 'B' + i }), i)!,
      settledAtTime: now - age,
    }));
    expect(recentWindow(rows, now).map((r) => r.id)).toEqual(['B0', 'B1', 'B2']);
  });
  it('integer-cent price bands keep every trade and exact GPU totals for all precisions', () => {
    const rows = [2.29, 2.3, 2.31, 2.99, 3].map(
      (price, i) =>
        normalizeSettlement(raw({ id: 'P' + i, perGpuHourly: price, gpuCount: i + 1 }), i)!,
    );
    const counts: Record<number, number> = { 100: 2, 10: 4, 1: 5 };
    for (const step of [100, 10, 1]) {
      const stats = priceBands(rows, step);
      expect(stats.bands.length).toBe(counts[step]);
      expect(stats.trades).toBe(5);
      expect(stats.totalGpus).toBe(15);
      expect(stats.bands.reduce((a, b) => a + b.gpus, 0)).toBe(15);
    }
    expect(bandLabel(230, 10).range).toBe('$2.30–$2.39');
    expect(bandLabel(200, 100).range).toBe('$2.00–$2.99');
    expect(bandLabel(231, 1).short).toBe('$2.31');
    expect(() => priceBands(rows, 5)).toThrow();
  });
  it('activity helpers allow only 20, 50 or 100 and the demo tape is deterministic', () => {
    const normalized = Array.from(
      { length: 125 },
      (_, i) =>
        normalizeSettlement(
          raw({ id: 'ORD-' + i, settledAt: new Date(Date.now() - i * 60000).toISOString() }),
          i,
        )!,
    ) as Settlement[];
    expect([...ACTIVITY_SHOW_OPTIONS]).toEqual([20, 50, 100]);
    for (const limit of [20, 50, 100]) expect(latestMatching(normalized, limit).length).toBe(limit);
    for (const malformed of [0, 19, 37, 101, Infinity, 'bad', null])
      expect(latestMatching(normalized, malformed).length).toBe(100);
    expect(latestMatching(normalized, 20)[0]?.id).toBe('ORD-0');
    expect(buildDemoSettlements().length).toBe(192);
    expect(synchronizeTradeModel(normalized, null)).toBe('H100 SXM');
    expect(synchronizeTradeModel(normalized, 'H100 SXM')).toBe('H100 SXM');
  });
});
