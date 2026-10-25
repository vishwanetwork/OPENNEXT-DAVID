import { describe, expect, it } from 'vitest';
import type { CuratedRfq } from '@opennext/contracts';
import { offerMessage, requirementRows, validCurated } from './curated';

const item: CuratedRfq = {
  id: 'CURATED-RFQ-B300-32-NON-US', kind: 'rental', side: 'demand', sourceKind: 'customer_requirement', title: '32 B300 servers',
  model: 'B300', modelOptions: ['B300'], region: 'Outside the United States', description: '32 B300 servers outside the United States.',
  quantityLabel: '32 servers', termLabel: '6 or 12 months', deliveryLabel: 'ASAP', paymentTerms: 'Flexible',
  specifications: [
    { label: 'Location', value: 'Any region outside the United States' },
    { label: 'Quantity', value: '32 servers' },
    { label: 'quantity', value: '32 servers' },
    { label: 'Empty', value: '' },
  ],
};

describe('curated inquiries', () => {
  it('uses the full specifications, de-duplicated and without blanks', () => {
    expect(requirementRows(item)).toEqual([
      { label: 'Location', value: 'Any region outside the United States' },
      { label: 'Quantity', value: '32 servers' },
    ]);
  });
  it('falls back to summary fields when specifications are missing', () => {
    expect(requirementRows({ ...item, specifications: [] }).map((row) => row.label)).toEqual(['Location', 'Hardware', 'Quantity', 'Rental term', 'Deployment', 'Payment']);
  });
  it('builds the offer message with the exact RFQ identity', () => {
    const message = offerMessage(item);
    expect(message.startsWith('I would like to offer capacity for RFQ CURATED-RFQ-B300-32-NON-US.\n\n32 B300 servers\n')).toBe(true);
    expect(message).toContain('Location: Any region outside the United States');
    expect(message.endsWith('My available capacity, delivery date and proposed commercial terms:\n')).toBe(true);
  });
  it('accepts only customer requirements with an id and title', () => {
    expect(validCurated(item)).toBe(true);
    expect(validCurated({ ...item, sourceKind: 'demo' })).toBe(false);
    expect(validCurated(null)).toBe(false);
  });
});
