import { describe, expect, it } from 'vitest';
import type { RegionalHistoryResponse } from '@opennext/contracts';
import {
  buildCatalog,
  countryFor,
  filterData,
  modelInfo,
  normalizeCountry,
  optionsCopy,
  requestQuery,
} from './insight-index';

const history: RegionalHistoryResponse = {
  term: 'Spot',
  metric: 'avg',
  regions: [
    { code: 'us-east-1', name: 'US East', city: 'N. Virginia' },
    { code: 'eu-west-2', name: 'London' },
  ],
  meta: { sourceKind: 'uploaded_daily_history', bucketMinutes: 1440 },
  series: [
    {
      id: 'a',
      region: 'us-east-1',
      gpuModel: 'H100',
      formFactor: 'SXM',
      gpuMemoryGb: 80,
      gpuCount: 8,
      vCpu: 192,
      instanceType: 'p5.48xlarge',
      points: [{ time: '2026-10-01', avg: 2 }],
    },
    {
      id: 'b',
      region: 'eu-west-2',
      gpuModel: 'H100',
      gpuCount: 8,
      gpuMemoryGb: 80,
      points: [{ time: '2026-10-01', avg: 3 }],
    },
    {
      id: 'c',
      region: 'eu-west-2',
      gpuModel: 'A100',
      gpuCount: 8,
      gpuMemoryGb: 40,
      points: [{ time: '2026-10-01', avg: 1 }],
    },
  ],
};

describe('insight index', () => {
  it('maps regions and cities to countries', () => {
    expect(countryFor('eu-west-2')).toBe('United Kingdom');
    expect(countryFor('xx-1', { city: 'Dubai' })).toBe('United Arab Emirates');
    expect(countryFor('xx-1', { country: 'usa' })).toBe('United States');
    expect(normalizeCountry('uk')).toBe('United Kingdom');
  });
  it('parses model labels into base, form factor and memory', () => {
    expect(modelInfo('H100 SXM')).toEqual({ base: 'H100', form: 'SXM', memory: null });
    expect(modelInfo('A100 80GB')).toEqual({ base: 'A100', form: null, memory: 80 });
    expect(modelInfo('GB200 NVL72').base).toBe('GB200');
  });
  it('keeps only matching model, country and hardware filters and counts unverifiable rows', () => {
    const options = optionsCopy({
      range: '7D',
      term: 'Spot',
      selected: { country: ['United Kingdom'] },
    });
    const result = filterData(history, options, 'H100');
    expect(result.data.series.map((s) => s.id)).toEqual(['b']);
    expect(result.data.regions.map((r) => r.code)).toEqual(['eu-west-2']);
    const vcpu = filterData(
      history,
      optionsCopy({ range: '7D', term: 'Spot', selected: { vcpu: ['96'] } }),
      'H100',
    );
    expect(vcpu.data.series).toEqual([]);
    expect(vcpu.unknown.vcpu).toBe(1);
    expect(
      filterData(history, optionsCopy({ range: '7D', term: 'On-demand' }), 'H100').data.series,
    ).toEqual([]);
  });
  it('builds a catalog of distinct configurations and request queries', () => {
    const catalog = buildCatalog(null, history);
    expect(catalog.models).toEqual(['A100', 'H100']);
    expect(catalog.rows).toHaveLength(3);
    expect(requestQuery(optionsCopy({ range: '24H' }), 'A100 80GB', 'Spot')).toBe(
      'gpuModel=A100&region=all&term=Spot&period=1D&metric=avg&gpuMemoryGb=80',
    );
    expect(optionsCopy({ range: 'bogus', term: 'Weekly' })).toMatchObject({
      range: null,
      term: 'All',
    });
  });
});
