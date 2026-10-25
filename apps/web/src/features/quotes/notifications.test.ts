import { describe, expect, it } from 'vitest';
import {
  accountRows,
  notices,
  ownerKey,
  prefill,
  quoteRequests,
  visibleStatus,
  QUOTE_MARKER,
} from './notifications';

const user = { id: 'u1', role: 'buyer', onboardingCompleted: true };
const owner = ownerKey(user, false);

describe('notifications', () => {
  it('scopes rows to the verified account and dedupes notices by id, newest first', () => {
    const rows = accountRows(
      [
        { id: 'a', ownerId: 'u1', subject: 'Quote', created: '2026-10-01T00:00:00Z' },
        { id: 'b', ownerId: 'u2' },
        { id: 'a', ownerId: 'u1', message: 'dup', created: '2026-10-02T00:00:00Z' },
      ],
      'notifications',
      'u1',
      owner,
    );
    const list = notices(rows, new Set(['a']));
    expect(list.map((n) => n.id)).toEqual(['a']);
    expect(list[0]).toMatchObject({ title: 'Workspace update', message: 'dup', read: true });
    expect(ownerKey({ ...user, onboardingCompleted: false }, false)).toBe('');
    expect(ownerKey(user, true)).toBe(JSON.stringify(['u1', 'buyer', true]));
    expect(
      accountRows(
        [
          { id: 'o', buyerId: 'u1' },
          { id: 'p', sellerId: 'u3' },
        ],
        'orders',
        'u1',
        owner,
      ).map((o) => o.id),
    ).toEqual(['o']);
  });
  it('quote requests are On-demand/Reserved requests marked as such, with honest visible status', () => {
    const rfqs = [
      {
        id: 'R1',
        ownerId: 'u1',
        term: 'On-demand',
        requestKind: 'quote_request',
        createdAt: '2026-10-01T00:00:00Z',
        status: 'Open',
        reviewStatus: 'Approved',
      },
      { id: 'R2', ownerId: 'u1', term: 'Spot', requestKind: 'quote_request' },
      {
        id: 'R3',
        ownerId: 'u1',
        term: 'Reserved',
        notes: 'x ' + QUOTE_MARKER,
        createdAt: '2026-10-03T00:00:00Z',
        status: 'Open',
        reviewStatus: 'Approved',
        visibility: 'Private RFQ',
      },
    ];
    const list = quoteRequests(accountRows(rfqs, 'rfqs', 'u1', owner));
    expect(list.map((r) => r.id)).toEqual(['R3', 'R1']);
    expect(visibleStatus(list[0])).toBe('Approved · Private RFQ');
    expect(visibleStatus(list[1])).toBe('Live RFQ');
    expect(visibleStatus({ status: 'Reviewing' })).toBe('Reviewing');
  });
  it('prefill maps an offer to RFQ fields, bounds numbers and resolves country codes', () => {
    const fields = prefill({
      id: 'o1',
      model: 'H100 SXM',
      country: 'UAE',
      term: 'Reserved',
      gpuCount: 8,
      vcpu: 192,
      memory: 80,
      perGpuHourly: 2.5,
      instanceHourly: 20,
    });
    expect(fields).toMatchObject({
      kind: 'gpu_rental',
      requestKind: 'quote_request',
      model: 'H100 SXM',
      region: 'United Arab Emirates',
      term: 'Reserved',
      count: 8,
      vcpu: 192,
      memory: 80,
      budget: 2.5,
      visibility: 'Public requirements',
    });
    expect(
      prefill({ model: 'X', term: 'On-demand', gpuCount: 1.5, country: 'Singapore' }),
    ).toMatchObject({ count: 8, vcpu: '', region: 'Singapore' });
    expect(() => prefill({ model: 'X', term: 'Spot' })).toThrow(/On-demand or Reserved/);
    expect(() => prefill({ model: '', term: 'Reserved' })).toThrow(/no model/);
  });
});
