import { describe, expect, it } from 'vitest';
import type { RegionalHistoryResponse } from '@opennext/contracts';
import { BASE_REGIONS } from './catalog';
import {
  emptyChoice,
  geometry,
  presentation,
  selection,
  seriesPath,
  summary,
  valueOf,
} from './regional-history';

const data = (over: Partial<RegionalHistoryResponse> = {}): RegionalHistoryResponse => ({
  term: 'Spot',
  metric: 'avg',
  regions: [
    { code: 'us-east-1', name: 'US East', city: 'N. Virginia' },
    { code: 'eu-west-1', name: 'Ireland', city: 'Dublin' },
  ],
  meta: { bucketMinutes: 60 },
  series: [
    {
      id: 'a',
      region: 'us-east-1',
      name: 'US East · p5.48xlarge',
      configuration: 'p5.48xlarge · 8 × H100',
      gpuCount: 8,
      points: [
        { time: '2026-10-20T00:00:00Z', min: 2, avg: 2.5, max: 3 },
        { time: '2026-10-20T01:00:00Z', min: 2.1, avg: 2.6, max: 3.1 },
      ],
    },
    {
      id: 'b',
      region: 'eu-west-1',
      name: 'Ireland',
      configuration: '8 × H100',
      gpuCount: 8,
      points: [{ time: '2026-10-20T00:00:00Z', min: 2.4, avg: 2.9, max: 3.3 }],
    },
    {
      id: 'c',
      region: 'eu-west-1',
      name: 'Ireland',
      configuration: '8 × H100',
      gpuCount: 8,
      points: [{ time: '2026-10-20T00:00:00Z', value: 2.95 }],
    },
    {
      id: 'frac',
      region: 'us-east-1',
      gpuCount: 0,
      points: [{ time: '2026-10-20T00:00:00Z', avg: 9 }],
    },
  ],
  ...over,
});
const S = {
  model: 'H100',
  count: 8,
  region: 'All regions',
  term: 'Spot',
  period: '3D',
  priceMetric: 'avg' as const,
  priceMetrics: ['avg' as const],
};

describe('selection', () => {
  it('selects the first three eligible series once and ignores fractional GPUs', () => {
    const state = emptyChoice();
    const result = selection(S, data(), state);
    expect(result.selected.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(result.changed).toBe(true);
    expect(state.initialized).toBe(false);
    expect(result.known.some((s) => s.id === 'frac')).toBe(false);
    const again = selection(S, data(), { ...result.state, selected: ['b'] });
    expect(again.selected.map((s) => s.id)).toEqual(['b']);
    expect(again.changed).toBe(false);
  });
  it('keeps a series that only reports the requested metric as value', () => {
    expect(valueOf({ time: 't', value: 2.95 }, S, { metric: 'avg' })).toBe(2.95);
    expect(valueOf({ time: 't', value: 2.95 }, S, { metric: 'min' })).toBeNull();
    expect(valueOf({ time: 't', avg: null, value: 2.95 }, S, { metric: 'avg' })).toBeNull();
  });
  it('labels duplicate region/configuration pairs as numbered series without machine codes', () => {
    const { known } = selection(S, data(), emptyChoice());
    const b = known.find((s) => s.id === 'b')!;
    const c = known.find((s) => s.id === 'c')!;
    expect(presentation(b, known, data(), BASE_REGIONS)).toEqual({
      name: 'Ireland',
      description: '8 × H100 · Series 1',
      label: 'Ireland · 8 × H100 · Series 1',
    });
    expect(presentation(c, known, data(), BASE_REGIONS).description).toBe('8 × H100 · Series 2');
    const a = known.find((s) => s.id === 'a')!;
    expect(presentation(a, known, data(), BASE_REGIONS).name).toBe('US East');
    expect(presentation(a, known, data(), BASE_REGIONS).description).toBe('8 × H100');
  });
});

describe('summary and geometry', () => {
  it('summarises the first selected series with observations', () => {
    const info = summary(S, data(), emptyChoice(), BASE_REGIONS)!;
    expect(info.latest).toBe(2.6);
    expect(info.change).toBeCloseTo(4, 0);
    expect(info.points).toBe(2);
    expect(info.region).toBe('US East');
  });
  it('breaks lines across gaps and draws one curve per metric', () => {
    const multi = { ...S, priceMetrics: ['max' as const, 'min' as const] };
    const result = selection(multi, data(), emptyChoice());
    const geo = geometry(multi, data(), result, BASE_REGIONS, 900)!;
    expect(geo.series.filter((s) => s.id === 'a').map((s) => s.metric)).toEqual(['max', 'min']);
    const gapped = {
      ...geo.series[0],
      points: geo.series[0].points.map((p, i) => ({
        ...p,
        timestamp: p.timestamp + (i ? 10 * 3600_000 : 0),
      })),
    };
    expect(seriesPath(gapped, geo.gap).split('M').length - 1).toBe(2);
    expect(geo.series.some((s) => s.id === 'c')).toBe(false);
  });
});
