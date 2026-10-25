import { describe, expect, it } from 'vitest';
import type { TickerRecord } from '@opennext/contracts';
import { sparkGeometry, tickerChange, validTickerRows } from './ticker';

const recorded: TickerRecord = {
  gpuModel: 'H100', country: 'Singapore', term: 'Spot', vcpu: 192, gpuMemoryGb: 80, perGpuHourly: 2.4, historical: true,
  points: [
    { date: '2026-10-18', value: 2.0 },
    { date: '2026-10-19', value: 2.1 },
    { date: '2026-10-20', value: null },
    { date: '2026-10-22', value: 2.3 },
    { date: '2026-10-24', value: 2.4 },
  ],
};

describe('ticker', () => {
  it('keeps only recorded Spot histories with more than one observation', () => {
    expect(validTickerRows([recorded])).toHaveLength(1);
    expect(validTickerRows([{ ...recorded, historical: false }])).toHaveLength(0);
    expect(validTickerRows([{ ...recorded, term: 'On-demand' }])).toHaveLength(0);
    expect(validTickerRows([{ ...recorded, points: [{ date: '2026-10-18', value: 2 }] }])).toHaveLength(0);
  });
  it('never bridges explicit missing observations or unrecorded calendar gaps', () => {
    const geometry = sparkGeometry(recorded.points!)!;
    expect((geometry.path.match(/M/g) || []).length).toBe(3);
    expect((geometry.path.match(/L/g) || []).length).toBe(1);
    expect(geometry.path).not.toMatch(/NaN|Infinity/);
    expect(geometry.count).toBe(4);
    expect(new Date(geometry.start).toISOString()).toMatch(/^2026-10-18/);
    expect(new Date(geometry.end).toISOString()).toMatch(/^2026-10-24/);
  });
  it('reports the change between the first and last recorded values', () => {
    expect(tickerChange(recorded.points!)).toBeCloseTo(20, 5);
    expect(tickerChange([])).toBeNull();
  });
  it('returns null geometry when nothing is recorded', () => {
    expect(sparkGeometry([{ date: '2026-10-18', value: null }])).toBeNull();
  });
});
