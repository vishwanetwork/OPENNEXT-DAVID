import { describe, expect, it } from 'vitest';
import type { CuratedRfq, PublicMarketResponse } from '@opennext/contracts';
import { HARDWARE_REFERENCES, MODEL_LISTINGS, RENTAL_REFERENCES } from '@/data/catalog';
import {
  disclosureFor,
  findListing,
  hasApprovedRentalLanes,
  isHighUrgency,
  positionLabel,
  rowsFor,
} from './listings';

const curated: CuratedRfq = {
  id: 'CURATED-RFQ-1',
  kind: 'rental',
  side: 'demand',
  sourceKind: 'customer_requirement',
  title: '32 B300 servers',
  model: 'B300',
  region: 'Outside the United States',
  description: 'desc',
  quantityLabel: '32 servers',
  termLabel: '6 or 12 months',
  deliveryLabel: 'ASAP',
  specifications: [{ label: 'Location', value: 'Any region outside the United States' }],
};
const rental = (id: string, side: 'demand' | 'supply', extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'rental',
  side,
  model: 'H100',
  title: id,
  region: 'US',
  price: 2,
  ...extra,
});
const empty: PublicMarketResponse = {
  rfqs: [],
  supplies: [],
  featured: { rfqs: [], supplies: [] },
};

describe('rowsFor', () => {
  it('shows only the featured backend lanes for rental and keeps catalog references out of demand', () => {
    const market = {
      ...empty,
      rfqs: [rental('RFQ-A', 'demand')],
      featured: { rfqs: [rental('RFQ-F', 'demand')], supplies: [rental('SUP-F', 'supply')] },
    };
    const demand = rowsFor('rental', 'demand', { market, showcase: null, curated: [] });
    expect(demand.map((r) => r.id)).toEqual(['RFQ-F']);
    expect(
      rowsFor('rental', 'supply', { market, showcase: null, curated: [] }).map((r) => r.id),
    ).toEqual(['SUP-F']);
  });
  it('interleaves curated requirements with demo demand until approved rows exist, without duplicate ids', () => {
    const showcase = {
      rfqs: [
        rental('CURATED-RFQ-1', 'demand'),
        rental('DEMO-1', 'demand'),
        rental('DEMO-2', 'demand'),
      ],
      supplies: [rental('DEMO-S', 'supply')],
    };
    const rows = rowsFor('rental', 'demand', { market: empty, showcase, curated: [curated] });
    expect(rows.map((r) => r.id)).toEqual(['CURATED-RFQ-1', 'DEMO-1', 'DEMO-2']);
    expect(rows[1]).toMatchObject({
      exchange: true,
      demo: true,
      name: 'DEMO-1',
      note: '',
      region: 'US',
    });
    expect(disclosureFor(rows)).toBe(
      'Includes demo listings · Availability, pricing and delivery confirmed by quote.',
    );
  });
  it('approved rental requirements supersede the showcase while curated RFQs remain', () => {
    const market = { ...empty, featured: { rfqs: [rental('RFQ-REAL', 'demand')], supplies: [] } };
    const showcase = { rfqs: [rental('DEMO-1', 'demand')], supplies: [] };
    const rows = rowsFor('rental', 'demand', { market, showcase, curated: [curated] });
    expect(rows.map((r) => r.id)).toEqual(['CURATED-RFQ-1', 'RFQ-REAL']);
    expect(rows.some((r) => 'demo' in r && r.demo)).toBe(false);
    expect(disclosureFor(rows)).toBe(
      'Buyer requirements · Pricing, capacity and delivery confirmed in supplier quotes.',
    );
  });
  it('empty model and hardware lanes keep dated catalog references in supply only', () => {
    expect(rowsFor('model', 'supply', { market: empty, showcase: null, curated: [] })).toBe(
      MODEL_LISTINGS,
    );
    expect(rowsFor('hardware', 'supply', { market: empty, showcase: null, curated: [] })).toBe(
      HARDWARE_REFERENCES,
    );
    expect(rowsFor('model', 'demand', { market: empty, showcase: null, curated: [] })).toEqual([]);
    expect(rowsFor('rental', 'supply', { market: empty, showcase: null, curated: [] })).toEqual([]);
  });
  it('published model supply takes precedence over the catalog fallback and maps backend kinds', () => {
    const market = {
      ...empty,
      supplies: [
        {
          id: 'SUP-M',
          kind: 'model_capacity',
          side: 'supply' as const,
          model: 'GPT',
          title: 'Model API',
          price: 2,
          outputPrice: 10,
        },
      ],
    };
    const rows = rowsFor('model', 'supply', { market, showcase: null, curated: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'SUP-M',
      exchange: true,
      input: 2,
      output: 10,
      region: 'Flexible region',
    });
  });
  it('supplier indications precede unmatched official references in the model catalog', () => {
    expect(MODEL_LISTINGS[0].priceKind).toBe('supplier_quote');
    expect(MODEL_LISTINGS.some((item) => item.priceKind === 'public_api_reference')).toBe(true);
    expect(MODEL_LISTINGS.filter((item) => item.id === 'model-gemini-lite')).toHaveLength(1);
  });
  it('rental references are buyer targets per GPU-hour and hardware servers keep whole-system prices', () => {
    expect(
      RENTAL_REFERENCES.every(
        (item) => item.priceKind === 'buyer_target' && item.unit === 'USD / GPU-hour',
      ),
    ).toBe(true);
    const server = HARDWARE_REFERENCES.find((item) => item.id === 'hardware-hgx-b200');
    expect(server).toMatchObject({ unit: 'server', price: 402198.5 });
  });
});

describe('helpers', () => {
  it('normalises urgency', () => {
    expect(isHighUrgency('high')).toBe(true);
    expect(isHighUrgency('High urgency')).toBe(true);
    expect(isHighUrgency('urgent')).toBe(true);
    expect(isHighUrgency('Standard')).toBe(false);
  });
  it('formats carousel positions', () => {
    expect(positionLabel(0, 0, 5)).toBe('No listings');
    expect(positionLabel(14, 0, 5)).toBe('01 — 05 / 14');
    expect(positionLabel(14, 12, 5)).toBe('13 — 03 / 14');
    expect(positionLabel(3, 0, 5)).toBe('01 — 03 / 3');
  });
  it('needs the showcase only until both approved rental lanes are populated', () => {
    expect(hasApprovedRentalLanes(empty)).toBe(false);
    expect(
      hasApprovedRentalLanes({
        ...empty,
        featured: { rfqs: [rental('a', 'demand')], supplies: [rental('b', 'supply')] },
      }),
    ).toBe(true);
  });
  it('finds listings in rendered rows, curated rows and the catalog', () => {
    expect(findListing('CURATED-RFQ-1', [[]], [curated])).toMatchObject({
      curated: true,
      name: '32 B300 servers',
    });
    expect(findListing('rental-h200-128', [[]], [])).toMatchObject({
      kind: 'rental',
      model: 'H200',
    });
    expect(findListing('missing', [[]], [])).toBeUndefined();
  });
});
