import { describe, expect, it } from 'vitest';
import type { MarketRow } from '@opennext/contracts';
import {
  bestFor,
  eligible,
  kindOf,
  marketRows,
  matchesFor,
  mergeNotifications,
  projectModel,
  recentFor,
  recordRegionMatches,
  regionCountry,
  tokenTotal,
  totalFor,
  useMarketplaceStore,
  type MarketplaceState,
} from './exchange';

const row = (over: Partial<MarketRow>): MarketRow => ({
  id: 'SUP-1',
  kind: 'rental',
  side: 'supply',
  model: 'H100',
  region: 'Germany',
  count: 8,
  hours: 72,
  term: 'Spot',
  price: 2.1,
  provider: 'Atlas',
  ...over,
});

describe('units and totals', () => {
  it('rental totals multiply GPU count by hours; hardware and tokens do not inherit rental hours', () => {
    expect(totalFor({ kind: 'gpu_rental', count: 8, hours: 10 }, 2)).toBe(160);
    expect(totalFor({ kind: 'physical_gpu', count: 4, hours: 0 }, 24500)).toBe(98000);
    expect(totalFor({ kind: 'model_capacity' }, 123.456)).toBe(123.46);
    expect(tokenTotal({ inputMillion: 10, outputMillion: 2 }, 0.5, 1.5)).toBe(8);
    expect(kindOf({ kind: 'hardware' })).toBe('physical_gpu');
    expect(kindOf({})).toBe('gpu_rental');
  });
});

describe('geography', () => {
  it('maps AWS codes, cities and country codes to country names', () => {
    expect(regionCountry('eu-central-1')).toBe('Germany');
    expect(regionCountry('us-east-1')).toBe('United States');
    expect(regionCountry('Tokyo')).toBe('Japan');
    expect(regionCountry('SG')).toBe('Singapore');
  });
  it('honours external region scopes: worldwide, flexible, Europe, EU-only, country lists and exclusions', () => {
    const ext = (regionScope: MarketRow['regionScope']) =>
      row({ external: true, region: 'Worldwide', regionScope });
    expect(recordRegionMatches(ext({ type: 'worldwide' }), 'Japan')).toBe(true);
    expect(
      recordRegionMatches(ext({ type: 'flexible', excludedCountries: ['Japan'] }), 'Japan'),
    ).toBe(false);
    expect(recordRegionMatches(ext({ type: 'europe' }), 'Switzerland')).toBe(true);
    expect(recordRegionMatches(ext({ type: 'europe', unionOnly: true }), 'Switzerland')).toBe(
      false,
    );
    expect(recordRegionMatches(ext({ type: 'europe', unionOnly: true }), 'Germany')).toBe(true);
    expect(
      recordRegionMatches(ext({ type: 'countries', countries: ['Singapore', 'Japan'] }), 'Tokyo'),
    ).toBe(true);
    expect(recordRegionMatches(ext({ type: 'countries', countries: ['Singapore'] }), 'Japan')).toBe(
      false,
    );
    expect(recordRegionMatches(row({ region: 'Frankfurt' }), 'All regions')).toBe(true);
    expect(recordRegionMatches(row({ region: 'Frankfurt' }), 'Germany')).toBe(true);
  });
});

describe('matching', () => {
  it('external rows without Spot terms or 8-GPU inventory still qualify and project alternative models', () => {
    const ext = row({
      id: 'EXT-1',
      external: true,
      term: null,
      count: null,
      quantity: { minNodes: 2, gpusPerNode: 8 },
      model: 'H200',
      modelOptions: ['H100'],
      modelBudgets: { H100: 1.9 },
    });
    expect(eligible(ext, { model: 'H200', region: 'Germany', count: 8, term: 'Spot' })).toBe(true);
    const projected = projectModel(ext, 'H100');
    expect(projected.model).toBe('H100');
    expect(projected.price).toBe(1.9);
    expect(projected.bestMatch).toBe(false);
    expect(projectModel(ext, 'B200')).toBe(ext);
  });
  it('sorts supply by lowest price, demand by highest, and falls back to reference rows only when nothing matches', () => {
    const market = {
      rfqs: [
        row({ id: 'RFQ-1', side: 'demand', price: 1 }),
        row({ id: 'RFQ-2', side: 'demand', price: 3 }),
      ],
      supplies: [row({ id: 'S-1', price: 3 }), row({ id: 'S-2', price: 1 })],
      featured: { rfqs: [], supplies: [] },
    };
    expect(
      matchesFor(market, { model: 'H100', region: 'Germany' }, 'supply').map((r) => r.id),
    ).toEqual(['S-2', 'S-1']);
    expect(
      matchesFor(market, { model: 'H100', region: 'Germany' }, 'demand').map((r) => r.id),
    ).toEqual(['RFQ-2', 'RFQ-1']);
    const state = {
      ...useMarketplaceStore.getState(),
      market,
      referenceCatalog: {
        supplies: [row({ id: 'REF-1', model: 'B200', referenceOnly: true, price: 5 })],
        rfqs: [],
        recent: [],
      },
      generated: new Map(),
    } as MarketplaceState;
    expect(
      marketRows(state, { model: 'B200', region: 'All regions' }, 'supply').map((r) => r.id),
    ).toEqual(['REF-1']);
    expect(marketRows(state, { model: 'B200', region: 'All regions' }, 'supply', true)).toEqual([]);
    expect(
      marketRows(state, { model: 'H100', region: 'All regions' }, 'supply').map((r) => r.id),
    ).toEqual(['S-2', 'S-1']);
  });
  it('best matches keep the selected model and region, never mark external rows as precise matches, and recent settlements respect the window', () => {
    const state = {
      ...useMarketplaceStore.getState(),
      bestRows: [
        row({ id: 'B-1', bestMatch: true }),
        row({ id: 'B-2', external: true, bestMatch: true, regionScope: { type: 'worldwide' } }),
        row({ id: 'B-3', model: 'B200' }),
      ],
      recentRows: [
        {
          id: 'ORD-1',
          model: 'H100',
          region: 'Germany',
          settledAt: new Date(Date.now() - 86400000).toISOString(),
          price: 2,
        },
        {
          id: 'ORD-2',
          model: 'H100',
          region: 'Germany',
          settledAt: new Date(Date.now() - 10 * 86400000).toISOString(),
          price: 2,
        },
        {
          id: 'ORD-3',
          model: 'H100',
          region: 'Germany',
          settledAt: new Date(Date.now() + 86400000).toISOString(),
          price: 2,
        },
      ],
      generated: new Map(),
    } as MarketplaceState;
    const best = bestFor(state, { model: 'H100', region: 'Germany' });
    expect(best.map((r) => [r.id, r.bestMatch])).toEqual([
      ['B-1', true],
      ['B-2', false],
    ]);
    expect(recentFor(state, { model: 'H100', region: 'Germany' }, 3).map((r) => r.id)).toEqual([
      'ORD-1',
    ]);
  });
});

describe('notifications', () => {
  it('keeps only account-owned rows, de-duplicates by id and sorts newest first', () => {
    const rows = mergeNotifications(
      'u1',
      [
        { id: 'a', ownerId: 'u1', created: '2026-01-01T00:00:00Z' },
        { id: 'b', ownerId: 'u2', created: '2026-02-01T00:00:00Z' },
      ],
      [
        { id: 'a', ownerId: 'u1', created: '2026-01-01T00:00:00Z', topupId: 'T' },
        { id: 'c', ownerId: 'u1', createdAt: '2026-03-01T00:00:00Z' },
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(['c', 'a']);
    expect(rows[1].topupId).toBe('T');
    expect(mergeNotifications(undefined, [{ id: 'a', ownerId: 'u1' }], [])).toEqual([]);
  });
});
