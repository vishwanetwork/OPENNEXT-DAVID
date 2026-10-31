import { describe, expect, it } from 'vitest';
import { OperationsBilling, OperationsUsers } from './admin';

describe('Console operations contracts', () => {
  it('requires authoritative totals and growth instead of inferring them from a page', () => {
    expect(OperationsUsers.safeParse({ users: [] }).success).toBe(false);
    expect(
      OperationsUsers.safeParse({
        users: [],
        totalUsers: 30,
        filteredTotal: 0,
        nextCursor: null,
        asOf: 'now',
        growth: { '7D': 1, '1M': 2, '3M': 3, '6M': 4, '1Y': 5 },
      }).success,
    ).toBe(true);
  });
  it('rejects negative monetary values and preserves unavailable provider invoices', () => {
    const value = {
      currency: 'USD',
      billedCents: 0,
      heldCents: 10,
      releasedCents: 0,
      providerInvoiceCents: null,
      entries: [],
      asOf: 'now',
    };
    expect(OperationsBilling.parse(value).providerInvoiceCents).toBeNull();
    expect(OperationsBilling.safeParse({ ...value, billedCents: -1 }).success).toBe(false);
  });
});
