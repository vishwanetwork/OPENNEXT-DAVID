import { describe, expect, it } from 'vitest';
import type { PriceRecord } from '@opennext/contracts';
import {
  BASE_REGIONS,
  cleanLabel,
  historyQuery,
  mergeRegions,
  normalizeMetrics,
  offersFor,
  regionalHistoryQuery,
  regionText,
} from './catalog';

const row = (over: Partial<PriceRecord>): PriceRecord => ({
  recordId: 'r1',
  provider: 'aws',
  gpuModel: 'H100',
  gpuMemoryGb: 80,
  formFactor: 'SXM',
  region: 'us-east-1',
  term: 'Spot',
  gpuCount: 8,
  perGpuHourly: 2.5,
  instanceHourly: 20,
  ...over,
});

describe('offersFor', () => {
  it('matches model, memory, form factor, region, term and count separately', () => {
    const records = [
      row({ recordId: 'a' }),
      row({ recordId: 'b', formFactor: 'PCIe', perGpuHourly: 2.1 }),
      row({ recordId: 'c', gpuMemoryGb: 40, gpuModel: 'A100', perGpuHourly: 1 }),
      row({ recordId: 'd', region: 'eu-west-1', perGpuHourly: 3 }),
    ];
    expect(
      offersFor(
        records,
        { model: 'H100 SXM', region: 'All regions', term: 'Spot', count: 8 },
        BASE_REGIONS,
      ).map((o) => o.id),
    ).toEqual(['a', 'd']);
    expect(
      offersFor(
        records,
        { model: 'H100 PCIe', region: 'All regions', term: 'Spot', count: 8 },
        BASE_REGIONS,
      ).map((o) => o.id),
    ).toEqual(['b']);
    expect(
      offersFor(
        records,
        { model: 'A100 80GB', region: 'All regions', term: 'Spot', count: 8 },
        BASE_REGIONS,
      ),
    ).toEqual([]);
    expect(
      offersFor(
        records,
        { model: 'H100', region: 'US East', term: 'Spot', count: 8 },
        BASE_REGIONS,
      ).map((o) => o.id),
    ).toEqual(['b', 'a']);
  });
  it('presents readable provider and region names sorted by price', () => {
    const [offer] = offersFor(
      [row({ underlyingProvider: 'Nebius' })],
      { model: 'H100' },
      BASE_REGIONS,
    );
    expect(offer?.provider).toBe('AWS · Nebius');
    expect(offer?.region).toBe('US East');
    expect(offer?.price).toBe(2.5);
  });
});

describe('history queries', () => {
  it('encodes model variants and region codes', () => {
    const q = new URLSearchParams(
      regionalHistoryQuery(
        {
          model: 'A100 PCIe',
          region: 'Frankfurt',
          term: 'Spot',
          count: 8,
          period: '1Y',
          priceMetric: 'avg',
          priceMetrics: ['max', 'avg'],
        },
        BASE_REGIONS,
      ),
    );
    expect(q.get('gpuModel')).toBe('A100');
    expect(q.get('region')).toBe('eu-central-1');
    expect(q.get('period')).toBe('3D');
    expect(q.get('formFactor')).toBe('PCIe');
    expect(q.get('gpuMemoryGb')).toBe('80');
    expect(q.get('metric')).toBe('avg');
    expect(
      new URLSearchParams(
        historyQuery({ model: 'H100 SXM', region: 'All regions', term: 'Spot' }, BASE_REGIONS),
      ).get('formFactor'),
    ).toBe('SXM');
  });
  it('keeps renamed regions addressable by their old names', () => {
    const merged = mergeRegions(BASE_REGIONS, [
      { code: 'us-east-1', name: 'Virginia', city: 'Ashburn' },
      { code: 'sa-east-1', name: 'São Paulo' },
    ]);
    expect(merged.find((r) => r.code === 'us-east-1')).toMatchObject({
      name: 'Virginia',
      aliases: ['US East'],
    });
    expect(
      new URLSearchParams(
        regionalHistoryQuery(
          {
            model: 'H100',
            region: 'US East',
            term: 'Spot',
            count: 8,
            period: '3D',
            priceMetric: 'avg',
            priceMetrics: ['avg'],
          },
          merged,
        ),
      ).get('region'),
    ).toBe('us-east-1');
    expect(merged.some((r) => r.code === 'sa-east-1')).toBe(true);
  });
});

describe('metrics and labels', () => {
  it('normalises price metrics in max/avg/min order and never empty', () => {
    expect(normalizeMetrics(['min', 'max'])).toEqual(['max', 'min']);
    expect(normalizeMetrics(['bogus'])).toEqual(['avg']);
    expect(normalizeMetrics(undefined, 'min')).toEqual(['min']);
  });
  it('removes instance sizes and region codes from labels', () => {
    expect(cleanLabel('US East · p5.48xlarge · us-east-1')).toBe('US East');
    expect(regionText(BASE_REGIONS, 'ap-southeast-1')).toBe('Singapore');
    expect(regionText(BASE_REGIONS, 'unspecified')).toBe('Region not specified');
  });
});
