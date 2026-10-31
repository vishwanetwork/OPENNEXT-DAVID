import { describe, expect, it } from 'vitest';
import { at } from '@/test/at';
import type { RegionalHistoryResponse } from '@opennext/contracts';
import { BASE_REGIONS } from './catalog';
import {
  emptyChoice,
  geometry,
  presentation,
  reconcileSelection,
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
const selection = {
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
    const result = reconcileSelection(selection, data(), state);
    expect(result.selected.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(result.changed).toBe(true);
    expect(state.initialized).toBe(false);
    expect(result.known.some((s) => s.id === 'frac')).toBe(false);
    const again = reconcileSelection(selection, data(), { ...result.state, selected: ['b'] });
    expect(again.selected.map((s) => s.id)).toEqual(['b']);
    expect(again.changed).toBe(false);
  });
  it('cleans backend separators from Jakarta display labels without changing series identity', () => {
    const response = data({
      regions: [{ code: 'ap-southeast-3', name: 'Jakarta · Indonesia', city: 'Jakarta' }],
      series: ['jakarta-a', 'jakarta-b'].map((id) => ({
        id,
        region: 'ap-southeast-3',
        name: 'Jakarta · ap-southeast-3',
        configuration: 'p5.48xlarge · 8 × H100 · 80 GB',
        gpuCount: 8,
        points: [{ time: '2026-10-20T00:00:00Z', min: 2, avg: 2.5, max: 3 }],
      })),
    });
    const { known, selected } = reconcileSelection(selection, response, emptyChoice());
    expect(selected.map((series) => series.id)).toEqual(['jakarta-a', 'jakarta-b']);
    const first = at(known, 0);
    expect(first.name).toBe('Jakarta · ap-southeast-3');
    expect(first.configuration).toBe('p5.48xlarge · 8 × H100 · 80 GB');
    expect(presentation(first, known, response, BASE_REGIONS)).toEqual({
      name: 'Jakarta',
      description: '8 × H100 80 GB Series 1',
      label: 'Jakarta 8 × H100 80 GB Series 1',
    });
    for (const series of known) {
      const display = presentation(series, known, response, BASE_REGIONS);
      for (const text of [display.name, display.description, display.label])
        expect(text).not.toContain('·');
    }
  });
  it('keeps a series that only reports the requested metric as value', () => {
    expect(valueOf({ time: 't', value: 2.95 }, selection, { metric: 'avg' })).toBe(2.95);
    expect(valueOf({ time: 't', value: 2.95 }, selection, { metric: 'min' })).toBeNull();
    expect(valueOf({ time: 't', avg: null, value: 2.95 }, selection, { metric: 'avg' })).toBeNull();
  });
  it('labels duplicate region/configuration pairs as numbered series without machine codes', () => {
    const { known } = reconcileSelection(selection, data(), emptyChoice());
    const b = known.find((s) => s.id === 'b')!;
    const c = known.find((s) => s.id === 'c')!;
    expect(presentation(b, known, data(), BASE_REGIONS)).toEqual({
      name: 'Ireland',
      description: '8 × H100 Series 1',
      label: 'Ireland 8 × H100 Series 1',
    });
    expect(presentation(c, known, data(), BASE_REGIONS).description).toBe('8 × H100 Series 2');
    const a = known.find((s) => s.id === 'a')!;
    expect(presentation(a, known, data(), BASE_REGIONS).name).toBe('US East');
    expect(presentation(a, known, data(), BASE_REGIONS).description).toBe('8 × H100');
  });
});

describe('summary and geometry', () => {
  it('summarises the first selected series with observations', () => {
    const info = summary(selection, data(), emptyChoice(), BASE_REGIONS)!;
    expect(info.latest).toBe(2.6);
    expect(info.change).toBeCloseTo(4, 0);
    expect(info.points).toBe(2);
    expect(info.region).toBe('US East');
  });
  it('breaks lines across gaps and draws one curve per metric', () => {
    const multi = { ...selection, priceMetrics: ['max' as const, 'min' as const] };
    const result = reconcileSelection(multi, data(), emptyChoice());
    const geo = geometry(multi, data(), result, BASE_REGIONS, 900)!;
    expect(geo.series.filter((s) => s.id === 'a').map((s) => s.metric)).toEqual(['max', 'min']);
    const primary = at(geo.series, 0);
    const gapped = {
      ...primary,
      points: primary.points.map((p, i) => ({
        ...p,
        timestamp: p.timestamp + (i ? 10 * 3600_000 : 0),
      })),
    };
    expect(seriesPath(gapped, geo.gap).split('M').length - 1).toBe(2);
    expect(geo.series.some((s) => s.id === 'c')).toBe(false);
  });
});
