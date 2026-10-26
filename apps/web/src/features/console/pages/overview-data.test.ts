import { describe, expect, it } from 'vitest';
import { MarketplaceSnapshot, type PricingProvider, type PriceRecord } from '@opennext/contracts';
import { availableSourceCount, recentOperations } from './overview-data';
import {
  collectedRows,
  emptyCatalogFilters,
  filterCatalog,
  instanceTerm,
} from './instance-catalog';

const now = Date.parse('2026-10-27T12:00:00Z');
const provider: PricingProvider = {
  id: 'aws',
  name: 'AWS',
  enabled: true,
  intervalMinutes: 15,
  adapterStatus: 'implemented',
};
const price: PriceRecord = {
  recordId: 'p1',
  provider: 'aws',
  gpuModel: 'H100',
  region: 'ap-southeast-1',
  term: 'Spot',
  gpuCount: 8,
  perGpuHourly: 2,
  instanceHourly: 16,
  vCpu: 192,
  gpuMemoryGb: 80,
  observedAt: '2026-10-27T11:59:00Z',
  currency: 'USD',
};

describe('real operations metrics', () => {
  it('counts fresh connected sources once, excluding stale, disabled and credential-blocked sources', () => {
    expect(availableSourceCount([provider], [price, price], now)).toBe(1);
    expect(availableSourceCount([{ ...provider, enabled: false }], [price], now)).toBe(0);
    expect(availableSourceCount([{ ...provider, credentialRequired: true }], [price], now)).toBe(0);
    expect(availableSourceCount([provider], [{ ...price, stale: true }], now)).toBe(0);
    expect(
      availableSourceCount([provider], [{ ...price, observedAt: '2026-10-25T00:00:00Z' }], now),
    ).toBe(0);
    expect(availableSourceCount([provider], [{ ...price, observedAt: 'invalid' }], now)).toBe(0);
  });
  it('only shows processed operations, newest first, with work-item links and a ten-event limit', () => {
    const marketplace = MarketplaceSnapshot.parse({
      audit: [
        { at: '2026-10-27T11:00:00Z', event: 'Requirement submitted', actor: 'Buyer', id: 'r1' },
        {
          at: '2026-10-27T13:00:00Z',
          event: 'Homepage candidate awaiting review',
          actor: 'System',
          id: 'h1',
        },
        {
          at: '2026-10-27T13:00:00Z',
          event: 'Supplier review submitted',
          actor: 'Buyer',
          id: 'k1',
        },
        ...Array.from({ length: 12 }, (_, n) => ({
          at: new Date(now - n * 60_000).toISOString(),
          event: 'RFQ operations review Approved',
          actor: 'Operations',
          id: 'r/' + n,
        })),
      ],
    });
    const result = recentOperations(marketplace);
    expect(result).toHaveLength(10);
    expect(result[0]?.path).toBe('/rfqs?record=r%2F0');
    expect(result.some((event) => event.actor === 'Buyer')).toBe(false);
  });
  it('does not invent operator names for contact history', () => {
    const events = recentOperations(
      undefined,
      [],
      [
        {
          id: 'c1',
          history: [{ at: '2026-10-27T11:00:00Z', status: 'Contacted' }],
        },
      ],
    );
    expect(events[0]?.actor).toBe('Not recorded');
    expect(events[0]?.path).toBe('/leads?record=c1');
  });
});

describe('source inventory catalog', () => {
  it('preserves full-node price and excludes unsupported terms, not relabelling them Spot', () => {
    expect(instanceTerm('Savings Plan')).toBeNull();
    expect(collectedRows([{ ...price, term: 'Savings Plan' }])).toEqual([]);
    expect(collectedRows([price])[0]).toMatchObject({
      hourly: 16,
      perGpuHourly: 2,
      country: 'Singapore',
      state: 'Price observation',
    });
  });
  it('filters model, capacity, country, CPU, memory and source without fabricated spec defaults', () => {
    const rows = collectedRows([
      price,
      { ...price, recordId: 'p2', vCpu: null, gpuMemoryGb: null },
    ]);
    expect(
      filterCatalog(rows, 'Spot', {
        ...emptyCatalogFilters(),
        vcpu: '192',
        memory: '80',
        capacity: '8',
        country: 'Singapore',
        source: 'aws',
      }),
    ).toHaveLength(1);
    expect(rows[1]?.vcpu).toBeNull();
    expect(filterCatalog(rows, 'Reserved', emptyCatalogFilters())).toEqual([]);
  });
});
